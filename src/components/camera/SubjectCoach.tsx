"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslations } from "next-intl";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CircleCheck, Loader2, ZoomIn, ZoomOut, type LucideIcon } from "lucide-react";
import { loadPeopleDetector, type PeopleDetector } from "@/lib/camera/detector";
import { HintStabilizer } from "@/lib/camera/exposure";
import {
  adviseSubject,
  fromFrame,
  onTarget,
  toPerson,
  type FrameGeometry,
  type Move,
  type Person,
  type SubjectAdvice,
} from "@/lib/camera/subject";

/** Cạnh dài của frame đưa vào model (model chỉ nhìn ~256px, thu nhỏ trước cho nhẹ GPU). */
const DETECT_EDGE = 512;
/** Khoảng cách giữa 2 lần nhận diện (ms) — tự giãn ra khi máy chậm. */
const FAST_MS = 100;
const SLOW_MS = 250;

const MOVE_ICON: Record<Move, LucideIcon> = {
  up: ArrowUp,
  down: ArrowDown,
  left: ArrowLeft,
  right: ArrowRight,
  back: ZoomOut,
  closer: ZoomIn,
};

type Status = "loading" | "error" | "running";

interface View {
  people: Person[];
  advice: SubjectAdvice | null;
}

/** Khoá ổn định của 1 lời nhắc: "none" = không thấy người, "good" = bố cục ổn. */
const keyOf = (a: SubjectAdvice | null) => (!a ? "none" : a.hint ? `${a.hint}:${a.move ?? ""}:${a.joint ?? ""}` : "good");

/** Chế độ Chân dung: nhận diện người, vẽ khung + điểm đích, nhắc dịch máy. */
export function SubjectCoach({ videoRef, geometry }: { videoRef: RefObject<HTMLVideoElement | null>; geometry: FrameGeometry }) {
  const [status, setStatus] = useState<Status>("loading");
  const [view, setView] = useState<View>({ people: [], advice: null });
  const [stable, setStable] = useState<{ key: string; advice: SubjectAdvice | null }>({ key: "none", advice: null });
  const geometryRef = useRef(geometry);
  useEffect(() => {
    geometryRef.current = geometry;
  }, [geometry]);

  useEffect(() => {
    let cancelled = false;
    let timer = 0;
    let detector: PeopleDetector | null = null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const stabilizer = new HintStabilizer<string>();
    const lastByKey = new Map<string, SubjectAdvice | null>();
    let shownKey = "";
    let lastTs = 0;

    const tick = () => {
      if (cancelled || !detector || !ctx) return;
      let delay = FAST_MS;
      const v = videoRef.current;
      // Tab ẩn → không nhận diện, đỡ tốn pin
      if (!document.hidden && v && v.readyState >= 2 && v.videoWidth) {
        const s = Math.min(1, DETECT_EDGE / Math.max(v.videoWidth, v.videoHeight));
        const w = Math.round(v.videoWidth * s);
        const h = Math.round(v.videoHeight * s);
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        ctx.drawImage(v, 0, 0, w, h);
        const started = performance.now();
        // MediaPipe bắt buộc timestamp tăng dần
        lastTs = Math.max(lastTs + 1, Math.round(started));
        try {
          const g = geometryRef.current;
          const people = detector.detect(canvas, lastTs).flatMap((o) => toPerson(o, g) ?? []);
          const advice = adviseSubject(people);
          const key = keyOf(advice);
          lastByKey.set(key, advice);
          const stableKey = stabilizer.push([key])[0];
          if (stableKey && stableKey !== shownKey) {
            shownKey = stableKey;
            setStable({ key: stableKey, advice: lastByKey.get(stableKey) ?? null });
          }
          setView({ people, advice });
        } catch {
          // 1 frame lỗi (vd camera vừa đổi kích thước) → bỏ qua
        }
        if (performance.now() - started > 60) delay = SLOW_MS;
      }
      timer = window.setTimeout(tick, delay);
    };

    loadPeopleDetector()
      .then((d) => {
        if (cancelled) return;
        detector = d;
        setStatus("running");
        tick();
      })
      .catch(() => !cancelled && setStatus("error"));

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [videoRef]);

  const g = geometry;
  const unit = g.r.h;
  const P = (p: { x: number; y: number }) => fromFrame(p, g);
  const good = stable.key === "good";
  const { advice } = view;
  const showCut = advice && keyOf(advice) === stable.key ? advice.cutAt : undefined;

  return (
    <>
      {status === "running" && advice && (
        <svg
          viewBox={`0 0 ${g.vw} ${g.vh}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
          data-testid="subject-overlay"
        >
          {view.people.map((p, i) => {
            const a = P({ x: p.left, y: p.headTop });
            const b = P({ x: p.right, y: p.bottom });
            return (
              <rect
                key={i}
                x={a.x}
                y={a.y}
                width={b.x - a.x}
                height={b.y - a.y}
                rx={unit * 0.02}
                fill="none"
                stroke={p === advice.main ? (good ? "#4ade80" : "#fbbf24") : "white"}
                strokeOpacity={p === advice.main ? 0.9 : 0.4}
                strokeWidth={2}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          {advice.target && <Target from={P(advice.main.eyes)} to={P(advice.target)} hit={onTarget(advice)} size={unit} />}
          <circle cx={P(advice.main.eyes).x} cy={P(advice.main.eyes).y} r={unit * 0.008} fill="white" />
          {showCut && (
            <circle
              cx={P(showCut).x}
              cy={P(showCut).y}
              r={unit * 0.03}
              fill="#ef4444"
              fillOpacity={0.35}
              stroke="#ef4444"
              strokeWidth={2}
              vectorEffect="non-scaling-stroke"
              data-testid="cut-marker"
            />
          )}
        </svg>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-3" aria-live="polite">
        <SubjectChip status={status} stable={stable} />
      </div>
    </>
  );
}

function Target({ from, to, hit, size }: { from: { x: number; y: number }; to: { x: number; y: number }; hit: boolean; size: number }) {
  const color = hit ? "#4ade80" : "white";
  return (
    <g data-testid="eye-target">
      {!hit && (
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke="white"
          strokeOpacity={0.7}
          strokeWidth={1.5}
          strokeDasharray="6 5"
          vectorEffect="non-scaling-stroke"
        />
      )}
      <circle cx={to.x} cy={to.y} r={size * 0.035} fill="none" stroke={color} strokeWidth={2} vectorEffect="non-scaling-stroke" />
      <circle cx={to.x} cy={to.y} r={size * 0.006} fill={color} />
    </g>
  );
}

function SubjectChip({ status, stable }: { status: Status; stable: { key: string; advice: SubjectAdvice | null } }) {
  const t = useTranslations("camera.subject");
  const chip = "flex max-w-sm items-center gap-2 rounded-full bg-black/60 px-3 py-1.5 text-center text-xs font-medium backdrop-blur";
  if (status === "loading") {
    return (
      <p className={chip} data-testid="subject-status">
        <Loader2 className="size-4 shrink-0 animate-spin" aria-hidden />
        {t("loading")}
      </p>
    );
  }
  if (status === "error") {
    return (
      <p className={`${chip} text-amber-300`} data-testid="subject-status">
        {t("error")}
      </p>
    );
  }
  const a = stable.advice;
  if (!a) {
    return (
      <p className={`${chip} text-white/70`} data-testid="subject-status">
        {t("none")}
      </p>
    );
  }
  if (!a.hint) {
    return (
      <p className={`${chip} text-green-400`} data-testid="subject-hint">
        <CircleCheck className="size-4 shrink-0" aria-hidden />
        {t("good")}
      </p>
    );
  }
  const Icon = a.move ? MOVE_ICON[a.move] : null;
  return (
    <p className={`${chip} text-amber-200`} data-testid="subject-hint">
      {Icon && <Icon className="size-4 shrink-0" aria-hidden />}
      {t(`hints.${a.hint}`, { move: a.move ?? "other", joint: a.joint ?? "other" })}
    </p>
  );
}
