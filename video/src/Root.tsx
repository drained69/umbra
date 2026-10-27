import React from "react";
import { Composition } from "remotion";
import { Movie } from "./Movie";
import { Thumbnail } from "./Thumbnail";
import { FPS, TOTAL_FRAMES } from "./timing.mjs";

export const Root: React.FC = () => (
  <>
    <Composition
      id="UmbraDemoLandscape"
      component={Movie}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ orientation: "landscape" as const, withAudio: true, voiceover: true }}
    />
    <Composition
      id="UmbraDemoPortrait"
      component={Movie}
      durationInFrames={TOTAL_FRAMES}
      fps={FPS}
      width={1080}
      height={1920}
      defaultProps={{ orientation: "portrait" as const, withAudio: true, voiceover: false }}
    />
    <Composition id="UmbraThumbnail" component={Thumbnail} durationInFrames={1} fps={FPS} width={1280} height={720} />
  </>
);
