import {
  Archive,
  Check,
  CheckCircle2,
  Coins,
  Gift,
  History,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Settings,
  Sparkles,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from "react";
import "./App.scss";
import { CoinBurst, type Burst } from "./components/CoinBurst";
import { MasonJarBank } from "./components/MasonJarBank";
import { missingFirebaseConfig } from "./lib/firebase";
import { kidColors } from "./lib/seedData";
import { normalizeMultiplier, tokensForTask } from "./lib/tokens";
import { useTokenStore } from "./stores/tokenStore";
import type {
  BurstKind,
  Kid,
  Reward,
  RewardRedemption,
  TokenEarning,
  TokenTask,
} from "./types";

type Notify = (message: string) => void;
type TriggerBurst = (kind: BurstKind, amount: number, label?: string) => void;
type FlowStepId = "record" | "bank" | "redeem" | "manage";

const tokenLabel = (tokens: number) =>
  `${tokens} token${tokens === 1 ? "" : "s"}`;

const messageFromError = (error: unknown) =>
  error instanceof Error ? error.message : "Something went sideways.";

const isToday = (ms?: number) => {
  if (!ms) return false;
  const then = new Date(ms);
  const now = new Date();
  return (
    then.getFullYear() === now.getFullYear() &&
    then.getMonth() === now.getMonth() &&
    then.getDate() === now.getDate()
  );
};

const formatWhen = (ms?: number) => {
  if (!ms) return "Just now";
  const date = new Date(ms);
  if (isToday(ms)) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
};

const numberFromInput = (value: string, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const multiplierFromInput = (value: string) =>
  normalizeMultiplier(numberFromInput(value, 1));

const formatMultiplier = (value: number) => {
  const normalized = normalizeMultiplier(value);
  return Number.isInteger(normalized)
    ? String(normalized)
    : normalized.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
};

const initialsFor = (name: string) =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "?";

const scrollShadowClass = (left: boolean, right: boolean) =>
  `${left ? "has-left-shadow" : ""} ${right ? "has-right-shadow" : ""}`.trim();

function useScrollShadows<T extends HTMLElement>(dependencyKey: string) {
  const ref = useRef<T | null>(null);
  const [shadows, setShadows] = useState({ left: false, right: false });

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const update = () => {
      const maxScroll = element.scrollWidth - element.clientWidth;
      const canScroll = maxScroll > 1;
      setShadows({
        left: canScroll && element.scrollLeft > 1,
        right: canScroll && element.scrollLeft < maxScroll - 1,
      });
    };

    update();
    element.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    const observer = new ResizeObserver(update);
    observer.observe(element);

    return () => {
      element.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      observer.disconnect();
    };
  }, [dependencyKey]);

  return { ref, shadows };
}

function usePortraitOrientationLock() {
  useEffect(() => {
    const orientation = screen.orientation;
    if (!orientation?.lock) return;

    const lockPortrait = () => {
      void orientation.lock("portrait-primary").catch(() => undefined);
    };

    lockPortrait();
    window.addEventListener("focus", lockPortrait);
    document.addEventListener("visibilitychange", lockPortrait);

    return () => {
      window.removeEventListener("focus", lockPortrait);
      document.removeEventListener("visibilitychange", lockPortrait);
    };
  }, []);
}

const flowSteps: Array<{
  id: FlowStepId;
  label: string;
  eyebrow: string;
  icon: ReactNode;
}> = [
  {
    id: "record",
    label: "Record task",
    eyebrow: "Step 1",
    icon: <CheckCircle2 size={18} />,
  },
  {
    id: "redeem",
    label: "Redeem reward",
    eyebrow: "Step 2",
    icon: <Gift size={18} />,
  },
  {
    id: "bank",
    label: "Token bank",
    eyebrow: "Step 3",
    icon: <Wallet size={18} />,
  },
  {
    id: "manage",
    label: "Manage",
    eyebrow: "Step 4",
    icon: <Settings size={18} />,
  },
];

function App() {
  const subscribe = useTokenStore((state) => state.subscribe);
  const seedStarterData = useTokenStore((state) => state.seedStarterData);
  const setSelectedKid = useTokenStore((state) => state.setSelectedKid);
  const store = useTokenStore();
  const [activeStep, setActiveStep] = useState<FlowStepId>("record");
  const [bursts, setBursts] = useState<Burst[]>([]);
  const [notice, setNotice] = useState("");
  const seeded = useRef(false);

  usePortraitOrientationLock();

  useEffect(() => subscribe(), [subscribe]);

  useEffect(() => {
    if (
      !store.loading &&
      !store.error &&
      !seeded.current &&
      (store.tasks.length === 0 || store.rewards.length === 0)
    ) {
      seeded.current = true;
      seedStarterData().catch((error: unknown) =>
        setNotice(messageFromError(error)),
      );
    }
  }, [
    seedStarterData,
    store.error,
    store.loading,
    store.rewards.length,
    store.tasks.length,
  ]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const activeKids = useMemo(
    () => store.kids.filter((kid) => kid.active),
    [store.kids],
  );
  const selectedKid =
    activeKids.find((kid) => kid.id === store.selectedKidId) ?? activeKids[0];
  const totalBanked = activeKids.reduce(
    (sum, kid) => sum + kid.bankedTokens,
    0,
  );
  const activeTaskCount = store.tasks.filter((task) => task.active).length;
  const activeRewardCount = store.rewards.filter(
    (reward) => reward.active,
  ).length;
  const stepStats: Record<FlowStepId, string> = {
    record: `${activeTaskCount} tasks`,
    bank: `${selectedKid?.bankedTokens ?? totalBanked} banked`,
    redeem: `${activeRewardCount} rewards`,
    manage: `${store.kids.length} kids`,
  };

  const triggerBurst: TriggerBurst = (kind, amount, label) => {
    const id = Date.now() + Math.random();
    const nextBurst = {
      id,
      amount,
      kind,
      label: label ?? (kind === "reward" ? `-${amount}` : `+${amount}`),
    };
    setBursts((current) => [...current, nextBurst]);
    window.setTimeout(() => {
      setBursts((current) => current.filter((burst) => burst.id !== id));
    }, 1400);
  };

  if (missingFirebaseConfig.length > 0) {
    return <ConfigNeeded />;
  }

  return (
    <div className="app-shell">
      <CoinBurst bursts={bursts} />
      <header className="topbar">
        <div>
          <p className="eyebrow">Summer Token Economy</p>
          <h1>Summer Token HQ</h1>
        </div>
      </header>

      {store.error ? <div className="app-alert">{store.error}</div> : null}
      {!store.loading && selectedKid ? (
        <KidSelector
          kids={activeKids}
          selectedKidId={selectedKid.id}
          onSelect={setSelectedKid}
        />
      ) : null}

      <main className="workflow">
        {store.loading ? (
          <LoadingPanel />
        ) : selectedKid ? (
          <>
            <WorkflowNav
              activeStep={activeStep}
              onSelect={setActiveStep}
              stepStats={stepStats}
            />
            <section className="flow-stage" aria-label="Token economy step">
              <FlowStepBar
                kid={selectedKid}
                step={activeStep}
                stepStats={stepStats}
              />
              <div className="step-content">
                {activeStep === "record" ? (
                  <QuickEarn
                    kid={selectedKid}
                    tasks={store.tasks}
                    earnings={store.earnings}
                    onBurst={triggerBurst}
                    onNotice={setNotice}
                  />
                ) : null}
                {activeStep === "bank" ? (
                  <div className="bank-step-stack">
                    <KidBank kid={selectedKid} onNotice={setNotice} />
                    <HistoryPanel
                      kid={selectedKid}
                      earnings={store.earnings}
                      redemptions={store.redemptions}
                      onNotice={setNotice}
                    />
                  </div>
                ) : null}
                {activeStep === "redeem" ? (
                  <RewardsPanel
                    kid={selectedKid}
                    rewards={store.rewards}
                    onBurst={triggerBurst}
                    onNotice={setNotice}
                  />
                ) : null}
                {activeStep === "manage" ? (
                  <ManagePanel
                    kids={store.kids}
                    tasks={store.tasks}
                    rewards={store.rewards}
                    onNotice={setNotice}
                  />
                ) : null}
              </div>
            </section>
          </>
        ) : (
          <FirstKidPanel onNotice={setNotice} />
        )}
      </main>

      {notice ? <div className="toast">{notice}</div> : null}
    </div>
  );
}

function ConfigNeeded() {
  return (
    <main className="setup-screen">
      <section className="setup-panel">
        <div className="setup-icon">
          <Settings size={28} />
        </div>
        <p className="eyebrow">Firebase setup</p>
        <h1>Connect the token bank</h1>
        <p>
          Add the Vite Firebase env vars for project{" "}
          <strong>token-economy-b08ac</strong>, then restart the dev server.
        </p>
        <pre>{missingFirebaseConfig.join("\n")}</pre>
      </section>
    </main>
  );
}

function LoadingPanel() {
  return (
    <section className="panel loading-panel">
      <RefreshCw className="spin" size={22} />
      <span>Loading the token bank</span>
    </section>
  );
}

function getFlowStep(stepId: FlowStepId) {
  return flowSteps.find((step) => step.id === stepId) ?? flowSteps[0];
}

function WorkflowNav({
  activeStep,
  onSelect,
}: {
  activeStep: FlowStepId;
  stepStats: Record<FlowStepId, string>;
  onSelect: (step: FlowStepId) => void;
}) {
  const { ref, shadows } = useScrollShadows<HTMLElement>("flow-nav");

  return (
    <div
      className={`flow-nav-frame ${scrollShadowClass(shadows.left, shadows.right)}`}
    >
      <nav className="flow-nav" aria-label="Token economy flow" ref={ref}>
        {flowSteps.map((step) => (
          <button
            aria-current={activeStep === step.id ? "step" : undefined}
            className={activeStep === step.id ? "is-active" : ""}
            key={step.id}
            onClick={() => onSelect(step.id)}
            type="button"
          >
            <span className="flow-nav-copy">
              <strong>{step.label}</strong>
            </span>
            <span className="flow-nav-icon">{step.icon}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function FlowStepBar({
  kid,
  step,
  // stepStats,
}: {
  kid: Kid;
  step: FlowStepId;
  stepStats: Record<FlowStepId, string>;
}) {
  const activeStep = getFlowStep(step);

  return (
    <div
      className="flow-step-bar"
      style={{ "--kid-color": kid.color } as CSSProperties}
    >
      <div className="flow-step-title">
        <h2>{activeStep.label}</h2>
      </div>
    </div>
  );
}

function KidSelector({
  kids,
  selectedKidId,
  onSelect,
}: {
  kids: Kid[];
  selectedKidId?: string;
  onSelect: (kidId: string) => void;
}) {
  const { ref, shadows } = useScrollShadows<HTMLDivElement>(
    `${selectedKidId ?? ""}:${kids.map((kid) => `${kid.id}-${kid.name}`).join("|")}`,
  );

  return (
    <section className="kid-selector" aria-label="Choose kid">
      <div className="kid-selector-head">
        <h2>Choose kid</h2>
      </div>
      <div
        className={`kid-card-frame ${scrollShadowClass(shadows.left, shadows.right)}`}
      >
        <div className="kid-card-grid" ref={ref}>
          {kids.map((kid) => (
            <button
              aria-pressed={kid.id === selectedKidId}
              className={`kid-card ${kid.id === selectedKidId ? "is-active" : ""}`}
              key={kid.id}
              onClick={() => onSelect(kid.id)}
              style={{ "--kid-color": kid.color } as CSSProperties}
              type="button"
            >
              <span className="kid-avatar">{initialsFor(kid.name)}</span>
              <span className="kid-card-main">
                <strong>{kid.name}</strong>
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function FirstKidPanel({ onNotice }: { onNotice: Notify }) {
  const addKid = useTokenStore((state) => state.addKid);
  const [name, setName] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await addKid({ name });
      setName("");
      onNotice("First kid added.");
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  return (
    <section className="panel empty-start">
      <div className="empty-icon">
        <Sparkles size={24} />
      </div>
      <h2>Add your first kid</h2>
      <p>
        The starter tasks and rewards are ready. Add a kid to start logging
        tokens.
      </p>
      <form className="inline-form" onSubmit={submit}>
        <input
          onChange={(event) => setName(event.target.value)}
          placeholder="Kid name"
          value={name}
        />
        <button type="submit">
          <Plus size={18} />
          Add
        </button>
      </form>
    </section>
  );
}

function QuickEarn({
  kid,
  tasks,
  earnings,
  onBurst,
  onNotice,
}: {
  kid: Kid;
  tasks: TokenTask[];
  earnings: TokenEarning[];
  onBurst: TriggerBurst;
  onNotice: Notify;
}) {
  const addEarning = useTokenStore((state) => state.addEarning);
  const addCustomEarning = useTokenStore((state) => state.addCustomEarning);
  const [note, setNote] = useState("");
  const [customTitle, setCustomTitle] = useState("");
  const [customTokens, setCustomTokens] = useState("1");
  const [customNote, setCustomNote] = useState("");
  const activeTasks = tasks.filter((task) => task.active);

  const completeTask = async (task: TokenTask) => {
    try {
      const tokens = await addEarning({
        kidId: kid.id,
        taskId: task.id,
        notes: note,
      });
      setNote("");
      onBurst("earn", tokens, `+${tokens}`);
      onNotice(`${kid.name} banked ${tokenLabel(tokens)}.`);
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  const completeCustomTask = async (event: FormEvent) => {
    event.preventDefault();
    if (!customTitle.trim()) return;

    try {
      const tokens = await addCustomEarning({
        kidId: kid.id,
        title: customTitle,
        tokens: Math.max(0, Math.round(numberFromInput(customTokens, 1))),
        notes: customNote,
      });
      setCustomTitle("");
      setCustomTokens("1");
      setCustomNote("");
      onBurst("earn", tokens, `+${tokens}`);
      onNotice(`${kid.name} banked ${tokenLabel(tokens)}.`);
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  return (
    <section className="panel quick-earn">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Fast log</p>
          <h2>What did {kid.name} finish?</h2>
        </div>
        <span className="summary-pill">
          <Coins size={16} />
          {kid.bankedTokens} banked
        </span>
      </div>

      <label className="note-field">
        <span>Optional note</span>
        <input
          onChange={(event) => setNote(event.target.value)}
          placeholder="Example: helped without being asked"
          value={note}
        />
      </label>

      <div className="task-grid">
        {activeTasks.map((task) => {
          const todayCount = earnings.filter(
            (earning) =>
              earning.kidId === kid.id &&
              earning.taskId === task.id &&
              isToday(earning.createdAt),
          ).length;
          const capped = Boolean(
            task.maxPerDay && todayCount >= task.maxPerDay,
          );
          const earnedTokens = tokensForTask(task.tokens, kid.pointMultiplier);
          const multiplierText =
            kid.pointMultiplier > 1
              ? `x${formatMultiplier(kid.pointMultiplier)} token value`
              : "";
          const maxPerDayText = task.maxPerDay
            ? `${todayCount}/${task.maxPerDay} today`
            : "";
          return (
            <button
              className="task-button"
              disabled={capped}
              key={task.id}
              onClick={() => completeTask(task)}
              type="button"
            >
              <span className="task-copy">
                <span className="task-title">{task.title}</span>
                {multiplierText || maxPerDayText ? (
                  <small>
                    {multiplierText ? <span>{multiplierText}</span> : null}
                    {maxPerDayText ? <span>{maxPerDayText}</span> : null}
                  </small>
                ) : null}
              </span>
              <strong className="task-tokens">+{earnedTokens}</strong>
            </button>
          );
        })}
      </div>

      <form className="custom-task-panel" onSubmit={completeCustomTask}>
        <div className="custom-task-head">
          <p className="eyebrow">One-off task</p>
          <strong>Custom task</strong>
        </div>
        <div className="custom-task-fields">
          <label className="edit-field">
            <span>Task name</span>
            <input
              onChange={(event) => setCustomTitle(event.target.value)}
              placeholder="Example: cleaned the playroom"
              value={customTitle}
            />
          </label>
          <label className="edit-field">
            <span>Tokens</span>
            <input
              min="0"
              onChange={(event) => setCustomTokens(event.target.value)}
              type="number"
              value={customTokens}
            />
          </label>
          <label className="edit-field">
            <span>Optional note</span>
            <input
              onChange={(event) => setCustomNote(event.target.value)}
              placeholder="Anything to remember"
              value={customNote}
            />
          </label>
          <button type="submit">
            <Plus size={16} />
            Add tokens
          </button>
        </div>
      </form>
    </section>
  );
}

function KidBank({ kid, onNotice }: { kid: Kid; onNotice: Notify }) {
  return (
    <section
      className="panel bank-panel"
      style={{ "--kid-color": kid.color } as CSSProperties}
    >
      <div className="bank-top">
        <div>
          <p className="eyebrow">{kid.name}</p>
          <h2>Tokens</h2>
        </div>
        <Wallet size={22} />
      </div>
      <div className="bank-summary">
        <div className="bank-number">{kid.bankedTokens}</div>
        <div className="bank-stats">
          <span>{kid.lifetimeEarned} earned</span>
          <span>{kid.lifetimeRedeemed} redeemed</span>
        </div>
      </div>
      <BankAdjustForm
        key={`${kid.id}-${kid.bankedTokens}`}
        kid={kid}
        onNotice={onNotice}
      />
      <MasonJarBank
        accentColor={kid.color}
        kidName={kid.name}
        onMotionNotice={onNotice}
        tokenCount={kid.bankedTokens}
      />
    </section>
  );
}

function BankAdjustForm({ kid, onNotice }: { kid: Kid; onNotice: Notify }) {
  const updateKid = useTokenStore((state) => state.updateKid);
  const [bankDraft, setBankDraft] = useState(String(kid.bankedTokens));

  const saveBank = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await updateKid(kid.id, {
        bankedTokens: Math.max(0, Math.round(numberFromInput(bankDraft))),
      });
      onNotice(`${kid.name}'s bank total updated.`);
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  return (
    <form className="bank-adjust" onSubmit={saveBank}>
      <label className="bold-label">Edit token count</label>
      <input
        aria-label="Token count"
        min="0"
        onChange={(event) => setBankDraft(event.target.value)}
        type="number"
        value={bankDraft}
      />
      <button type="submit">
        <Save size={16} />
        Save
      </button>
    </form>
  );
}

function RewardsPanel({
  kid,
  rewards,
  onBurst,
  onNotice,
}: {
  kid: Kid;
  rewards: Reward[];
  onBurst: TriggerBurst;
  onNotice: Notify;
}) {
  const redeemReward = useTokenStore((state) => state.redeemReward);
  const [note, setNote] = useState("");
  const activeRewards = rewards.filter((reward) => reward.active);

  const redeem = async (reward: Reward) => {
    try {
      const cost = await redeemReward({
        kidId: kid.id,
        rewardId: reward.id,
        notes: note,
      });
      onBurst("reward", cost, `-${cost}`);
      setNote("");
      onNotice(`${kid.name} redeemed ${reward.title}.`);
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  return (
    <section className="panel rewards-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Rewards</p>
          <h2>Spend {kid.name}'s banked tokens</h2>
        </div>
        <span className="summary-pill">
          <Coins size={16} />
          {kid.bankedTokens} banked
        </span>
      </div>
      <label className="note-field">
        <span>Optional redemption note</span>
        <input
          onChange={(event) => setNote(event.target.value)}
          placeholder="Example: Saturday movie"
          value={note}
        />
      </label>
      <div className="reward-grid">
        {activeRewards.map((reward) => {
          const short = kid.bankedTokens < reward.cost;
          return (
            <button
              className="reward-button"
              disabled={short}
              key={reward.id}
              onClick={() => redeem(reward)}
              type="button"
            >
              <span>{reward.title}</span>
              <strong>{reward.cost}</strong>
              <small>
                {short
                  ? `${reward.cost - kid.bankedTokens} more needed`
                  : "Redeem"}
              </small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function HistoryPanel({
  kid,
  earnings,
  redemptions,
  onNotice,
}: {
  kid: Kid;
  earnings: TokenEarning[];
  redemptions: RewardRedemption[];
  onNotice: Notify;
}) {
  const deleteEarning = useTokenStore((state) => state.deleteEarning);
  const deleteRedemption = useTokenStore((state) => state.deleteRedemption);
  const events = [
    ...earnings
      .filter((earning) => earning.kidId === kid.id)
      .map((earning) => ({
        id: earning.id,
        kind: "earning" as const,
        title: earning.taskTitle,
        amount: earning.tokens,
        status: "earned",
        notes: earning.notes,
        at: earning.createdAt,
      })),
    ...redemptions
      .filter((redemption) => redemption.kidId === kid.id)
      .map((redemption) => ({
        id: redemption.id,
        kind: "reward" as const,
        title: redemption.rewardTitle,
        amount: redemption.cost,
        status: "redeemed",
        notes: redemption.notes,
        at: redemption.createdAt,
      })),
  ].sort((a, b) => (b.at ?? 0) - (a.at ?? 0));

  const removeHistoryItem = async (event: (typeof events)[number]) => {
    const itemName = event.kind === "reward" ? "redemption" : "task completion";
    if (!window.confirm(`Delete this ${itemName} from ${kid.name}'s history?`))
      return;

    try {
      if (event.kind === "reward") {
        await deleteRedemption(event.id);
        onNotice("Reward redemption deleted and tokens refunded.");
      } else {
        await deleteEarning(event.id);
        onNotice("Task completion deleted and totals updated.");
      }
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  return (
    <section className="panel history-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Transactions</p>
          <h2>{kid.name}'s token history</h2>
        </div>
        <History size={22} />
      </div>
      {events.length === 0 ? (
        <div className="empty-line">No history yet.</div>
      ) : (
        <div className="history-list">
          {events.slice(0, 40).map((event) => (
            <div
              className={`history-row ${event.kind}`}
              key={`${event.kind}-${event.id}`}
            >
              <span className="history-icon">
                {event.kind === "reward" ? (
                  <Gift size={16} />
                ) : (
                  <Check size={16} />
                )}
              </span>
              <div className="history-copy">
                <strong>{event.title}</strong>
                <small>
                  {formatWhen(event.at)} - {event.status}
                </small>
                {event.notes ? <p>{event.notes}</p> : null}
              </div>
              <b>
                {event.kind === "reward" ? "-" : "+"}
                {event.amount}
              </b>
              <button
                aria-label={`Delete ${event.kind === "reward" ? "redemption" : "task completion"}`}
                className="history-delete"
                onClick={() => removeHistoryItem(event)}
                title={`Delete ${event.kind === "reward" ? "redemption" : "task completion"}`}
                type="button"
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ManagePanel({
  kids,
  tasks,
  rewards,
  onNotice,
}: {
  kids: Kid[];
  tasks: TokenTask[];
  rewards: Reward[];
  onNotice: Notify;
}) {
  const [tab, setTab] = useState<"tasks" | "rewards" | "kids">("tasks");

  return (
    <section className="panel manage-panel">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Manage</p>
          <h2>Lists and totals</h2>
        </div>
        <Settings size={22} />
      </div>
      <div className="segmented" role="tablist">
        <button
          className={tab === "tasks" ? "is-active" : ""}
          onClick={() => setTab("tasks")}
          type="button"
        >
          Tasks
        </button>
        <button
          className={tab === "rewards" ? "is-active" : ""}
          onClick={() => setTab("rewards")}
          type="button"
        >
          Rewards
        </button>
        <button
          className={tab === "kids" ? "is-active" : ""}
          onClick={() => setTab("kids")}
          type="button"
        >
          Kids
        </button>
      </div>
      {tab === "tasks" ? (
        <TaskManager tasks={tasks} onNotice={onNotice} />
      ) : null}
      {tab === "rewards" ? (
        <RewardManager rewards={rewards} onNotice={onNotice} />
      ) : null}
      {tab === "kids" ? <KidManager kids={kids} onNotice={onNotice} /> : null}
    </section>
  );
}

function TaskManager({
  tasks,
  onNotice,
}: {
  tasks: TokenTask[];
  onNotice: Notify;
}) {
  const addTask = useTokenStore((state) => state.addTask);
  const updateTask = useTokenStore((state) => state.updateTask);
  const [title, setTitle] = useState("");
  const [tokens, setTokens] = useState("1");
  const [maxPerDay, setMaxPerDay] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState({ title: "", tokens: "1", maxPerDay: "" });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      await addTask({
        title,
        tokens: Math.max(0, Math.round(numberFromInput(tokens, 1))),
        maxPerDay: numberFromInput(maxPerDay) || undefined,
      });
      setTitle("");
      setTokens("1");
      setMaxPerDay("");
      onNotice("Task added.");
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  const beginEdit = (task: TokenTask) => {
    setEditingId(task.id);
    setDraft({
      title: task.title,
      tokens: String(task.tokens),
      maxPerDay: task.maxPerDay ? String(task.maxPerDay) : "",
    });
  };

  const save = async () => {
    if (!editingId) return;
    try {
      await updateTask(editingId, {
        title: draft.title,
        tokens: Math.max(0, Math.round(numberFromInput(draft.tokens))),
        maxPerDay: numberFromInput(draft.maxPerDay) || undefined,
      });
      setEditingId(undefined);
      onNotice("Task updated.");
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  const toggle = async (task: TokenTask) => {
    try {
      await updateTask(task.id, { active: !task.active });
      onNotice(task.active ? "Task archived." : "Task restored.");
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  return (
    <div className="manager">
      <form className="manager-form kid-add-form" onSubmit={submit}>
        <label className="edit-field">
          <span>New task</span>
          <input
            onChange={(event) => setTitle(event.target.value)}
            placeholder="New task"
            value={title}
          />
        </label>
        <label className="edit-field">
          <span>Tokens</span>
          <input
            aria-label="Tokens"
            min="0"
            onChange={(event) => setTokens(event.target.value)}
            type="number"
            value={tokens}
          />
        </label>
        <label className="edit-field">
          <span>Daily max</span>
          <input
            aria-label="Max per day"
            min="0"
            onChange={(event) => setMaxPerDay(event.target.value)}
            placeholder="Daily max"
            type="number"
            value={maxPerDay}
          />
        </label>
        <button type="submit">
          <Plus size={16} />
          Add
        </button>
      </form>
      <div className="manager-list">
        {tasks.map((task) => (
          <div
            className={`manager-row task-manager-row ${editingId === task.id ? "is-editing" : ""} ${task.active ? "" : "is-archived"}`}
            key={task.id}
          >
            {editingId === task.id ? (
              <div className="manager-edit-fields task-edit-fields">
                <label className="edit-field">
                  <span>Task</span>
                  <input
                    onChange={(event) =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                    value={draft.title}
                  />
                </label>
                <label className="edit-field">
                  <span>Tokens</span>
                  <input
                    min="0"
                    onChange={(event) =>
                      setDraft({ ...draft, tokens: event.target.value })
                    }
                    type="number"
                    value={draft.tokens}
                  />
                </label>
                <label className="edit-field">
                  <span>Daily max</span>
                  <input
                    min="0"
                    onChange={(event) =>
                      setDraft({ ...draft, maxPerDay: event.target.value })
                    }
                    placeholder="Daily max"
                    type="number"
                    value={draft.maxPerDay}
                  />
                </label>
                <div className="icon-actions">
                  <button
                    aria-label="Save task"
                    onClick={save}
                    title="Save task"
                    type="button"
                  >
                    <Save size={16} />
                  </button>
                  <button
                    aria-label="Cancel task edit"
                    onClick={() => setEditingId(undefined)}
                    title="Cancel task edit"
                    type="button"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="manager-row-copy">
                  <strong>{task.title}</strong>
                  <small>
                    {tokenLabel(task.tokens)}
                    {task.maxPerDay ? ` - max ${task.maxPerDay}/day` : ""}
                  </small>
                </div>
                <div className="icon-actions">
                  <button
                    aria-label="Edit task"
                    onClick={() => beginEdit(task)}
                    title="Edit task"
                    type="button"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    aria-label={task.active ? "Archive task" : "Restore task"}
                    onClick={() => toggle(task)}
                    title={task.active ? "Archive task" : "Restore task"}
                    type="button"
                  >
                    {task.active ? (
                      <Archive size={16} />
                    ) : (
                      <RotateCcw size={16} />
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function RewardManager({
  rewards,
  onNotice,
}: {
  rewards: Reward[];
  onNotice: Notify;
}) {
  const addReward = useTokenStore((state) => state.addReward);
  const updateReward = useTokenStore((state) => state.updateReward);
  const [title, setTitle] = useState("");
  const [cost, setCost] = useState("1");
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState({ title: "", cost: "1" });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim()) return;
    try {
      await addReward({
        title,
        cost: Math.max(0, Math.round(numberFromInput(cost, 1))),
      });
      setTitle("");
      setCost("1");
      onNotice("Reward added.");
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  const beginEdit = (reward: Reward) => {
    setEditingId(reward.id);
    setDraft({ title: reward.title, cost: String(reward.cost) });
  };

  const save = async () => {
    if (!editingId) return;
    try {
      await updateReward(editingId, {
        title: draft.title,
        cost: Math.max(0, Math.round(numberFromInput(draft.cost))),
      });
      setEditingId(undefined);
      onNotice("Reward updated.");
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  const toggle = async (reward: Reward) => {
    try {
      await updateReward(reward.id, { active: !reward.active });
      onNotice(reward.active ? "Reward archived." : "Reward restored.");
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  return (
    <div className="manager">
      <form className="manager-form" onSubmit={submit}>
        <label className="edit-field">
          <span>New reward</span>
          <input
            onChange={(event) => setTitle(event.target.value)}
            placeholder="New reward"
            value={title}
          />
        </label>
        <label className="edit-field">
          <span>Cost</span>
          <input
            aria-label="Cost"
            min="0"
            onChange={(event) => setCost(event.target.value)}
            type="number"
            value={cost}
          />
        </label>
        <button type="submit">
          <Plus size={16} />
          Add
        </button>
      </form>
      <div className="manager-list">
        {rewards.map((reward) => (
          <div
            className={`manager-row ${editingId === reward.id ? "is-editing" : ""} ${reward.active ? "" : "is-archived"}`}
            key={reward.id}
          >
            {editingId === reward.id ? (
              <div className="manager-edit-fields reward-edit-fields">
                <label className="edit-field">
                  <span>Reward</span>
                  <input
                    onChange={(event) =>
                      setDraft({ ...draft, title: event.target.value })
                    }
                    value={draft.title}
                  />
                </label>
                <label className="edit-field">
                  <span>Cost</span>
                  <input
                    min="0"
                    onChange={(event) =>
                      setDraft({ ...draft, cost: event.target.value })
                    }
                    type="number"
                    value={draft.cost}
                  />
                </label>
                <div className="icon-actions">
                  <button
                    aria-label="Save reward"
                    onClick={save}
                    title="Save reward"
                    type="button"
                  >
                    <Save size={16} />
                  </button>
                  <button
                    aria-label="Cancel reward edit"
                    onClick={() => setEditingId(undefined)}
                    title="Cancel reward edit"
                    type="button"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="manager-row-copy">
                  <strong>{reward.title}</strong>
                  <small>{tokenLabel(reward.cost)}</small>
                </div>
                <div className="icon-actions">
                  <button
                    aria-label="Edit reward"
                    onClick={() => beginEdit(reward)}
                    title="Edit reward"
                    type="button"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    aria-label={
                      reward.active ? "Archive reward" : "Restore reward"
                    }
                    onClick={() => toggle(reward)}
                    title={reward.active ? "Archive reward" : "Restore reward"}
                    type="button"
                  >
                    {reward.active ? (
                      <Archive size={16} />
                    ) : (
                      <RotateCcw size={16} />
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function KidManager({ kids, onNotice }: { kids: Kid[]; onNotice: Notify }) {
  const addKid = useTokenStore((state) => state.addKid);
  const updateKid = useTokenStore((state) => state.updateKid);
  const [name, setName] = useState("");
  const [pointMultiplier, setPointMultiplier] = useState("1");
  const [editingId, setEditingId] = useState<string>();
  const [draft, setDraft] = useState({
    name: "",
    color: kidColors[0],
    bankedTokens: "0",
    pointMultiplier: "1",
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    try {
      await addKid({
        name,
        pointMultiplier: multiplierFromInput(pointMultiplier),
      });
      setName("");
      setPointMultiplier("1");
      onNotice("Kid added.");
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  const beginEdit = (kid: Kid) => {
    setEditingId(kid.id);
    setDraft({
      name: kid.name,
      color: kid.color,
      bankedTokens: String(kid.bankedTokens),
      pointMultiplier: formatMultiplier(kid.pointMultiplier),
    });
  };

  const save = async () => {
    if (!editingId) return;
    try {
      await updateKid(editingId, {
        name: draft.name,
        color: draft.color,
        bankedTokens: Math.max(
          0,
          Math.round(numberFromInput(draft.bankedTokens)),
        ),
        pointMultiplier: multiplierFromInput(draft.pointMultiplier),
      });
      setEditingId(undefined);
      onNotice("Kid updated.");
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  const toggle = async (kid: Kid) => {
    try {
      await updateKid(kid.id, { active: !kid.active });
      onNotice(kid.active ? "Kid archived." : "Kid restored.");
    } catch (error) {
      onNotice(messageFromError(error));
    }
  };

  return (
    <div className="manager">
      <form className="manager-form" onSubmit={submit}>
        <label className="edit-field">
          <span>New kid</span>
          <input
            onChange={(event) => setName(event.target.value)}
            placeholder="New kid"
            value={name}
          />
        </label>
        <label className="edit-field">
          <span>Point multiplier</span>
          <input
            min="1"
            onChange={(event) => setPointMultiplier(event.target.value)}
            step="0.25"
            type="number"
            value={pointMultiplier}
          />
        </label>
        <button type="submit">
          <Plus size={16} />
          Add
        </button>
      </form>
      <div className="manager-list">
        {kids.map((kid) => (
          <div
            className={`manager-row ${editingId === kid.id ? "is-editing" : ""} ${kid.active ? "" : "is-archived"}`}
            key={kid.id}
          >
            {editingId === kid.id ? (
              <div className="manager-edit-fields kid-edit-fields">
                <label className="edit-field">
                  <span>Name</span>
                  <input
                    onChange={(event) =>
                      setDraft({ ...draft, name: event.target.value })
                    }
                    value={draft.name}
                  />
                </label>
                <label className="edit-field color-edit-field">
                  <span>Icon color</span>
                  <span
                    className="color-edit-control"
                    style={{ "--kid-color": draft.color } as CSSProperties}
                  >
                    <span className="kid-dot" />
                    <input
                      aria-label="Kid icon color"
                      onChange={(event) =>
                        setDraft({ ...draft, color: event.target.value })
                      }
                      type="color"
                      value={draft.color}
                    />
                  </span>
                </label>
                <label className="edit-field">
                  <span>Point multiplier</span>
                  <input
                    min="1"
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        pointMultiplier: event.target.value,
                      })
                    }
                    step="0.25"
                    type="number"
                    value={draft.pointMultiplier}
                  />
                </label>
                <label className="edit-field">
                  <span>Banked tokens</span>
                  <input
                    aria-label="Banked tokens"
                    min="0"
                    onChange={(event) =>
                      setDraft({ ...draft, bankedTokens: event.target.value })
                    }
                    type="number"
                    value={draft.bankedTokens}
                  />
                </label>
                <div className="icon-actions">
                  <button
                    aria-label="Save kid"
                    onClick={save}
                    title="Save kid"
                    type="button"
                  >
                    <Save size={16} />
                  </button>
                  <button
                    aria-label="Cancel kid edit"
                    onClick={() => setEditingId(undefined)}
                    title="Cancel kid edit"
                    type="button"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div
                  className="kid-manager-name"
                  style={{ "--kid-color": kid.color } as CSSProperties}
                >
                  <span className="kid-dot" />
                  <div className="kid-manager-copy">
                    <strong>{kid.name}</strong>
                    <small>{kid.bankedTokens} banked</small>
                    <small>
                      x{formatMultiplier(kid.pointMultiplier)} task multiplier
                    </small>
                  </div>
                </div>
                <div className="icon-actions">
                  <button
                    aria-label="Edit kid"
                    onClick={() => beginEdit(kid)}
                    title="Edit kid"
                    type="button"
                  >
                    <Pencil size={16} />
                  </button>
                  <button
                    aria-label={kid.active ? "Archive kid" : "Restore kid"}
                    onClick={() => toggle(kid)}
                    title={kid.active ? "Archive kid" : "Restore kid"}
                    type="button"
                  >
                    {kid.active ? (
                      <Archive size={16} />
                    ) : (
                      <RotateCcw size={16} />
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default App;
