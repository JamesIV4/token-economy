import type { CSSProperties } from "react";
import type { BurstKind } from "../types";

export type Burst = {
  id: number;
  amount: number;
  label: string;
  kind: BurstKind;
};

const pieces = Array.from({ length: 18 }, (_, index) => index);

export function CoinBurst({ bursts }: { bursts: Burst[] }) {
  return (
    <div className="burst-layer" aria-hidden="true">
      {bursts.map((burst) => (
        <div className={`burst burst-${burst.kind}`} key={burst.id}>
          <div className="burst-label">{burst.label}</div>
          {pieces.map((piece) => (
            <span
              className="burst-coin"
              key={piece}
              style={
                {
                  "--delay": `${piece * 18}ms`,
                  "--x": `${((piece % 6) - 2.5) * 24}px`,
                  "--y": `${-110 - (piece % 5) * 18}px`,
                  "--spin": `${piece % 2 === 0 ? 360 : -360}deg`,
                } as CSSProperties
              }
            >
              T
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
