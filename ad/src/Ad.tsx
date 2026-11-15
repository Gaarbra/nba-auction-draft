import React from "react";
import {
  AbsoluteFill,
  Sequence,
  Img,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
} from "remotion";
import { COLOR, DISPLAY } from "./brand";

type Format = "landscape" | "vertical";

/* ----------------------------------------------------------------- brand mark */
const BasketballMark: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 100 100" fill="none">
    <circle cx="50" cy="50" r="45" stroke={COLOR.accent} strokeWidth="4" />
    <path d="M50 5 V95 M5 50 H95" stroke={COLOR.accent} strokeWidth="4" />
    <path d="M18 14 Q50 50 18 86" stroke={COLOR.accent} strokeWidth="4" fill="none" />
    <path d="M82 14 Q50 50 82 86" stroke={COLOR.accent} strokeWidth="4" fill="none" />
  </svg>
);

/* --------------------------------------------------------------- backgrounds */
const Backdrop: React.FC = () => (
  <AbsoluteFill
    style={{
      background: `radial-gradient(120% 80% at 50% 0%, ${COLOR.panel} 0%, ${COLOR.void} 60%)`,
    }}
  />
);

// Fades the whole scene in and out so cuts cross-dissolve instead of snapping.
const SceneShell: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 12, dur - 12, dur - 1], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

// Slow zoom/pan on a still so it never feels like a frozen screenshot.
const KenBurns: React.FC<{ src: string; dur: number; fit: "cover" | "contain"; radius?: number }> = ({
  src,
  dur,
  fit,
  radius = 0,
}) => {
  const frame = useCurrentFrame();
  const scale = interpolate(frame, [0, dur], [1.08, 1.0], { extrapolateRight: "clamp" });
  const y = interpolate(frame, [0, dur], [-14, 14], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ overflow: "hidden", borderRadius: radius }}>
      <Img
        src={staticFile(`shots/${src}`)}
        style={{
          width: "100%",
          height: "100%",
          objectFit: fit,
          transform: `scale(${scale}) translateY(${y}px)`,
        }}
      />
    </AbsoluteFill>
  );
};

/* -------------------------------------------------------------------- titles */
const useEnter = (delay: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 22 });
  return { opacity: s, y: interpolate(s, [0, 1], [26, 0]) };
};

const Kicker: React.FC<{ text: string; delay?: number }> = ({ text, delay = 2 }) => {
  const e = useEnter(delay);
  return (
    <div
      style={{
        fontFamily: DISPLAY,
        color: COLOR.accent,
        fontSize: 26,
        fontWeight: 700,
        letterSpacing: 6,
        textTransform: "uppercase",
        opacity: e.opacity,
        transform: `translateY(${e.y}px)`,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <span style={{ width: 40, height: 3, background: COLOR.accent, borderRadius: 2 }} />
      {text}
    </div>
  );
};

const Headline: React.FC<{ text: string; size: number; delay?: number }> = ({ text, size, delay = 8 }) => {
  const words = text.split(" ");
  return (
    <h1
      style={{
        fontFamily: DISPLAY,
        color: COLOR.text,
        fontSize: size,
        fontWeight: 800,
        lineHeight: 1.04,
        letterSpacing: -1,
        margin: 0,
        display: "flex",
        flexWrap: "wrap",
        gap: "0 0.28em",
      }}
    >
      {words.map((w, i) => (
        <Word key={i} word={w} delay={delay + i * 3} />
      ))}
    </h1>
  );
};

const Word: React.FC<{ word: string; delay: number }> = ({ word, delay }) => {
  const e = useEnter(delay);
  return (
    <span style={{ display: "inline-block", opacity: e.opacity, transform: `translateY(${e.y}px)` }}>{word}</span>
  );
};

const Sub: React.FC<{ text: string; size: number; delay?: number }> = ({ text, size, delay = 18 }) => {
  const e = useEnter(delay);
  return (
    <p
      style={{
        fontFamily: DISPLAY,
        color: COLOR.dim,
        fontSize: size,
        fontWeight: 500,
        margin: 0,
        opacity: e.opacity,
        transform: `translateY(${e.y}px)`,
      }}
    >
      {text}
    </p>
  );
};

/* -------------------------------------------------------------------- scenes */
const IntroScene: React.FC<{ dur: number; format: Format }> = ({ dur, format }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame, fps, config: { damping: 12, mass: 0.6 } });
  const markSize = format === "landscape" ? 150 : 180;
  const wordSize = format === "landscape" ? 96 : 92;
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 28 }}>
      <div style={{ transform: `scale(${interpolate(pop, [0, 1], [0.6, 1])}) rotate(${interpolate(pop, [0, 1], [-25, 0])}deg)` }}>
        <BasketballMark size={markSize} />
      </div>
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: wordSize,
          fontWeight: 800,
          letterSpacing: 2,
          color: COLOR.text,
          opacity: interpolate(frame, [10, 28], [0, 1], { extrapolateRight: "clamp" }),
          transform: `translateY(${interpolate(frame, [10, 28], [20, 0], { extrapolateRight: "clamp" })}px)`,
        }}
      >
        HOOP <span style={{ color: COLOR.accent }}>BIDS</span>
      </div>
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: format === "landscape" ? 30 : 34,
          color: COLOR.dim,
          fontWeight: 500,
          opacity: interpolate(frame, [26, 44], [0, 1], { extrapolateRight: "clamp" }),
        }}
      >
        NBA auction drafts, with friends.
      </div>
    </AbsoluteFill>
  );
};

const FeatureCover: React.FC<{
  dur: number;
  format: Format;
  src: string;
  kicker: string;
  headline: string;
  sub?: string;
}> = ({ dur, format, src, kicker, headline, sub }) => {
  const landscape = format === "landscape";
  return (
    <AbsoluteFill>
      <KenBurns src={src} dur={dur} fit="cover" />
      <AbsoluteFill
        style={{
          background: landscape
            ? `linear-gradient(90deg, ${COLOR.void}f2 0%, ${COLOR.void}cc 32%, ${COLOR.void}00 70%)`
            : `linear-gradient(0deg, ${COLOR.void}f5 0%, ${COLOR.void}c0 30%, ${COLOR.void}00 62%)`,
        }}
      />
      <AbsoluteFill
        style={{
          padding: landscape ? "0 110px" : "0 70px",
          flexDirection: "column",
          justifyContent: landscape ? "center" : "flex-end",
          alignItems: "flex-start",
          paddingBottom: landscape ? 0 : 180,
          gap: landscape ? 24 : 22,
        }}
      >
        <Kicker text={kicker} />
        <div style={{ maxWidth: landscape ? 980 : "100%" }}>
          <Headline text={headline} size={landscape ? 82 : 72} />
        </div>
        {sub ? <Sub text={sub} size={landscape ? 32 : 30} /> : null}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const FeatureCard: React.FC<{
  dur: number;
  format: Format;
  src: string;
  kicker: string;
  headline: string;
  sub?: string;
}> = ({ dur, format, src, kicker, headline, sub }) => {
  const landscape = format === "landscape";
  return (
    <AbsoluteFill style={{ padding: landscape ? 90 : 70, flexDirection: "column", justifyContent: "center", gap: 40 }}>
      <div style={{ gap: 20, display: "flex", flexDirection: "column" }}>
        <Kicker text={kicker} />
        <Headline text={headline} size={landscape ? 72 : 60} />
        {sub ? <Sub text={sub} size={landscape ? 30 : 28} /> : null}
      </div>
      <div
        style={{
          flex: 1,
          borderRadius: 20,
          border: `1px solid ${COLOR.line}`,
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(0,0,0,0.6)",
          maxHeight: landscape ? "55%" : "48%",
          position: "relative",
        }}
      >
        <KenBurns src={src} dur={dur} fit="cover" />
      </div>
    </AbsoluteFill>
  );
};

const CTAScene: React.FC<{ dur: number; format: Format }> = ({ dur, format }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const pop = spring({ frame: frame - 4, fps, config: { damping: 14 } });
  const landscape = format === "landscape";
  return (
    <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 30 }}>
      <div style={{ opacity: interpolate(frame, [0, 14], [0, 1], { extrapolateRight: "clamp" }) }}>
        <BasketballMark size={landscape ? 96 : 110} />
      </div>
      <div
        style={{
          fontFamily: DISPLAY,
          fontSize: landscape ? 88 : 80,
          fontWeight: 800,
          color: COLOR.text,
          letterSpacing: -1,
          opacity: interpolate(frame, [8, 22], [0, 1], { extrapolateRight: "clamp" }),
          transform: `translateY(${interpolate(frame, [8, 22], [20, 0], { extrapolateRight: "clamp" })}px)`,
          textAlign: "center",
        }}
      >
        Play free.
      </div>
      <div
        style={{
          transform: `scale(${interpolate(pop, [0, 1], [0.8, 1])})`,
          background: COLOR.accent,
          color: COLOR.void,
          fontFamily: DISPLAY,
          fontWeight: 800,
          fontSize: landscape ? 40 : 42,
          letterSpacing: 1,
          padding: landscape ? "22px 56px" : "24px 50px",
          borderRadius: 999,
          boxShadow: `0 20px 60px ${COLOR.accent}44`,
        }}
      >
        girma.me/hoopbids
      </div>
    </AbsoluteFill>
  );
};

/* ----------------------------------------------------------------- timeline */
type Scene = { dur: number; node: React.ReactNode };

const buildScenes = (format: Format): Scene[] => {
  const L = format === "landscape";
  const mob = !L;
  const shot = (desktop: string, mobile: string) => (mob ? mobile : desktop);

  if (L) {
    return [
      { dur: 90, node: <IntroScene dur={90} format={format} /> },
      {
        dur: 120,
        node: (
          <FeatureCover dur={120} format={format} src={shot("desktop-lobby.png", "mobile-lobby.png")} kicker="The draft" headline="Draft the greatest players in NBA history." />
        ),
      },
      {
        dur: 150,
        node: (
          <FeatureCover dur={150} format={format} src="desktop-reveal.png" kicker="Live auctions" headline="Bid against up to 8 friends in real time." />
        ),
      },
      {
        dur: 150,
        node: (
          <FeatureCover dur={150} format={format} src="desktop-modes.png" kicker="Game modes" headline="Classic. Active Now. Peak Season." sub="Every era. Real NBA data." />
        ),
      },
      {
        dur: 120,
        node: (
          <FeatureCover dur={120} format={format} src="desktop-results.png" kicker="The payoff" headline="Build the best team. Settle it." />
        ),
      },
      { dur: 120, node: <CTAScene dur={120} format={format} /> },
    ];
  }

  return [
    { dur: 80, node: <IntroScene dur={80} format={format} /> },
    {
      dur: 105,
      node: <FeatureCover dur={105} format={format} src="mobile-lobby.png" kicker="The draft" headline="Draft the NBA greats." />,
    },
    {
      dur: 120,
      node: <FeatureCover dur={120} format={format} src="mobile-reveal.png" kicker="Live auctions" headline="Bid against up to 8 friends." />,
    },
    {
      dur: 110,
      node: <FeatureCard dur={110} format={format} src="desktop-modes.png" kicker="Game modes" headline="Classic. Active Now. Peak Season." />,
    },
    {
      dur: 100,
      node: <FeatureCover dur={100} format={format} src="mobile-results.png" kicker="The payoff" headline="Build the best team." />,
    },
    { dur: 85, node: <CTAScene dur={85} format={format} /> },
  ];
};

export const Ad: React.FC<{ format: Format }> = ({ format }) => {
  const scenes = buildScenes(format);
  let from = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: COLOR.void }}>
      <Backdrop />
      {scenes.map((s, i) => {
        const el = (
          <Sequence key={i} from={from} durationInFrames={s.dur}>
            <SceneShell dur={s.dur}>{s.node}</SceneShell>
          </Sequence>
        );
        from += s.dur;
        return el;
      })}
    </AbsoluteFill>
  );
};
