import { MasonJarBank, type JarTransactionKind } from "./MasonJarBank";

export type JarTransactionBurst = {
  id: number;
  accentColor: string;
  amount: number;
  disableInteraction?: boolean;
  kidName: string;
  kind: JarTransactionKind;
  label: string;
  startCount: number;
};

export function JarTransactionLayer({
  burst,
  onDone,
}: {
  burst?: JarTransactionBurst;
  onDone: () => void;
}) {
  if (!burst) return null;

  return (
    <div className="jar-transaction-layer" aria-live="polite">
      <section className={`jar-transaction-card is-${burst.kind}`}>
        <MasonJarBank
          accentColor={burst.accentColor}
          kidName={burst.kidName}
          presentation="transaction"
          tokenCount={burst.startCount}
          transaction={{
            amount: burst.amount,
            disableInteraction: burst.disableInteraction,
            id: burst.id,
            kind: burst.kind,
            onComplete: onDone,
            startCount: burst.startCount,
          }}
        />
        <div className="jar-transaction-label">{burst.label}</div>
      </section>
    </div>
  );
}
