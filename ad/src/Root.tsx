import { Composition } from "remotion";
import { Ad } from "./Ad";

// Landscape for web/landing/YouTube; vertical for Reels/TikTok/Shorts.
export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="AdLandscape"
        component={Ad}
        durationInFrames={750}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{ format: "landscape" as const }}
      />
      <Composition
        id="AdVertical"
        component={Ad}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={{ format: "vertical" as const }}
      />
    </>
  );
};
