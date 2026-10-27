import React from "react";
import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { Stage, type Orientation } from "./components/Stage";
import { sectionTimeline } from "./timing.mjs";
import { Cover } from "./scenes/Cover";
import { Land } from "./scenes/Land";
import { Connect } from "./scenes/Connect";
import { Account } from "./scenes/Account";
import { Deposit } from "./scenes/Deposit";
import { Send } from "./scenes/Send";
import { Request } from "./scenes/Request";
import { Swap } from "./scenes/Swap";
import { Result } from "./scenes/Result";
import { Outro } from "./scenes/Outro";
import "./fonts";

const SCENES: Record<string, React.FC<{ orientation: Orientation }>> = {
  cover: () => <Cover />,
  land: Land,
  connect: Connect,
  account: Account,
  deposit: Deposit,
  send: Send,
  request: Request,
  swap: Swap,
  result: Result,
  outro: () => <Outro />,
};

// `voiceover` picks the narrated master (YouTube cut); without it the music-only master plays.
export const Movie: React.FC<{ orientation: Orientation; withAudio?: boolean; voiceover?: boolean }> = ({ orientation, withAudio = true, voiceover = false }) => {
  const timeline = sectionTimeline() as { id: string; startFrame: number; durationInFrames: number }[];
  return (
    <AbsoluteFill style={{ background: "#0c1210", fontFamily: '"DM Sans", system-ui, sans-serif', fontFeatureSettings: '"tnum" 1', WebkitFontSmoothing: "antialiased" }}>
      <style>{`*,*::before,*::after{box-sizing:border-box} h1,h2,h3,p{margin:0}`}</style>
      <Stage>
        {timeline.map((s) => {
          const Scene = SCENES[s.id];
          return (
            <Sequence key={s.id} from={s.startFrame} durationInFrames={s.durationInFrames} name={s.id}>
              <Scene orientation={orientation} />
            </Sequence>
          );
        })}
      </Stage>
      {withAudio && <Audio src={staticFile(voiceover ? "audio/soundtrack-vo.wav" : "audio/soundtrack.wav")} />}
    </AbsoluteFill>
  );
};
