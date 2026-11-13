import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, KeyRound, RefreshCw, ShieldAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

type PreviewAgentNode = {
  nodeId: string;
  storeId: string;
  status: "pending" | "active" | "revoked";
  publicKeyFingerprint: string | null;
  agentVersion: string | null;
  platform: string | null;
  keyVersion: number;
  pairingExpiresAt: string | null;
  pairedAt: string | null;
  lastSeenAt: string | null;
  revokedAt: string | null;
  createdAt: string;
};

type PairingSetup = {
  nodeId: string;
  storeId: string;
  pairingCode: string;
  expiresAt: string;
};

const queryKey = (projectId: string) => [
  "/api/projects",
  projectId,
  "preview-agents",
];

const statusLabels: Record<PreviewAgentNode["status"], string> = {
  pending: "بانتظار الاقتران",
  active: "مقترن",
  revoked: "ملغى",
};

const errorLabels: Record<string, string> = {
  preview_agent_store_already_paired: "هذا المخزن مرتبط بعامل نشط بالفعل.",
  preview_agent_key_already_registered: "مفتاح هذا الجهاز مسجل مسبقًا.",
  preview_agent_pairing_conflict: "تعارض طلب الاقتران. حدّث القائمة ثم أعد المحاولة.",
  preview_agent_pairing_temporarily_unavailable: "خدمة الاقتران غير متاحة مؤقتًا.",
  preview_agent_pairing_invalid: "تعذر التحقق من طلب الاقتران.",
  preview_agent_not_found: "لم يعد هذا العامل موجودًا في المشروع.",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseNode(value: unknown): PreviewAgentNode | null {
  if (!isRecord(value)) return null;
  if (
    typeof value.nodeId !== "string" ||
    typeof value.storeId !== "string" ||
    (value.status !== "pending" &&
      value.status !== "active" &&
      value.status !== "revoked") ||
    typeof value.keyVersion !== "number" ||
    typeof value.createdAt !== "string"
  ) {
    return null;
  }
  const optionalString = (field: unknown) =>
    typeof field === "string" ? field : null;
  return {
    nodeId: value.nodeId,
    storeId: value.storeId,
    status: value.status,
    publicKeyFingerprint: optionalString(value.publicKeyFingerprint),
    agentVersion: optionalString(value.agentVersion),
    platform: optionalString(value.platform),
    keyVersion: value.keyVersion,
    pairingExpiresAt: optionalString(value.pairingExpiresAt),
    pairedAt: optionalString(value.pairedAt),
    lastSeenAt: optionalString(value.lastSeenAt),
    revokedAt: optionalString(value.revokedAt),
    createdAt: value.createdAt,
  };
}

async function responseError(response: Response): Promise<Error> {
  let code = "";
  try {
    const body: unknown = await response.json();
    if (isRecord(body) && typeof body.error === "string") code = body.error;
  } catch {
    // Use a stable user-facing message if the response body is not JSON.
  }
  return new Error(
    errorLabels[code] ??
      (response.status >= 500
        ? "تعذر الاتصال بالخدمة الآن."
        : "لم يُقبل الطلب. حدّث الصفحة وحاول مجددًا."),
  );
}

async function fetchNodes(projectId: string): Promise<PreviewAgentNode[]> {
  const response = await fetch(
    `/api/projects/${encodeURIComponent(projectId)}/preview-agents`,
    { credentials: "include", cache: "no-store" },
  );
  if (!response.ok) throw await responseError(response);
  const value: unknown = await response.json();
  if (!Array.isArray(value)) throw new Error("تعذر قراءة قائمة الأجهزة.");
  const nodes = value.map(parseNode);
  if (nodes.some((node) => node === null)) {
    throw new Error("استجابة قائمة الأجهزة غير مكتملة.");
  }
  return nodes as PreviewAgentNode[];
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "لا توجد نبضة مسجلة";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "وقت غير معروف"
    : new Intl.DateTimeFormat("ar", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(date);
}

function PairingCode({
  setup,
  onExpire,
}: {
  setup: PairingSetup;
  onExpire: () => void;
}) {
  const [copyState, setCopyState] = useState<"code" | "command" | null>(null);
  const [expired, setExpired] = useState(
    new Date(setup.expiresAt).getTime() <= Date.now(),
  );
  const onExpireRef = useRef(onExpire);
  onExpireRef.current = onExpire;
  const command = [
    "node lib/preview-agent-client/dist/cli.js pair",
    `--api ${window.location.origin}`,
    `--node ${setup.nodeId}`,
    `--store ${setup.storeId}`,
    `--expires ${setup.expiresAt}`,
  ].join(" ");

  useEffect(() => {
    const remaining = new Date(setup.expiresAt).getTime() - Date.now();
    if (!Number.isFinite(remaining)) {
      onExpireRef.current();
      return;
    }
    if (remaining <= 0) {
      setExpired(true);
      onExpireRef.current();
      return;
    }
    const timer = window.setTimeout(() => {
      setExpired(true);
      onExpireRef.current();
    }, remaining);
    return () => window.clearTimeout(timer);
  }, [setup.expiresAt]);

  async function copy(value: string, kind: "code" | "command") {
    try {
      await navigator.clipboard.writeText(value);
      setCopyState(kind);
      window.setTimeout(() => setCopyState(null), 2000);
    } catch {
      setCopyState(null);
    }
  }

  if (expired) {
    return (
      <div className="mt-4 rounded-lg border border-amber-400/20 bg-amber-300/[.06] p-3 text-xs leading-5 text-amber-100/80" role="status">
        انتهت صلاحية رمز الاقتران. أنشئ طلبًا جديدًا؛ لن يظهر الرمز القديم مرة أخرى.
      </div>
    );
  }

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-teal-400/20 bg-teal-300/[.04] p-3">
      <div className="flex items-start gap-2 text-xs leading-5 text-teal-100/80">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          هذا الرمز يظهر الآن فقط، وتنتهي صلاحيته في {formatDate(setup.expiresAt)}.
          أدخله في نافذة Agent الآمنة؛ لا تضعه في الأمر أو في ملف.
        </p>
      </div>
      <div className="flex items-center gap-2" dir="ltr">
        <code className="min-w-0 flex-1 select-all break-all rounded bg-slate-950/60 px-3 py-2 text-sm text-slate-100">
          {setup.pairingCode}
        </code>
        <button
          type="button"
          onClick={() => void copy(setup.pairingCode, "code")}
          className="workspace-retry shrink-0"
          aria-label="نسخ رمز الاقتران"
        >
          <Copy className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div>
        <p className="mb-1 text-xs text-slate-400">نفّذ هذا الأمر من نسخة المشروع على Linux:</p>
        <code dir="ltr" className="block break-all rounded bg-slate-950/60 p-2 text-left text-[11px] leading-5 text-slate-300">
          pnpm --filter @workspace/preview-agent-client run build &amp;&amp; {command}
        </code>
        <button
          type="button"
          onClick={() =>
            void copy(
              `pnpm --filter @workspace/preview-agent-client run build && ${command}`,
              "command",
            )
          }
          className="mt-2 inline-flex items-center gap-1.5 text-xs text-teal-200 hover:text-teal-100"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          {copyState === "command" ? "نُسخ الأمر" : "نسخ الأمر"}
        </button>
      </div>
      <p className="text-[11px] leading-5 text-slate-500">
        سيطلب البرنامج الرمز دون إظهاره أثناء الكتابة. لا يسجل هذا الاقتران
        صلاحية لتنفيذ Jobs أو قراءة ملفات المشروع أو تشغيل Preview.
      </p>
    </div>
  );
}

export default function PreviewAgentPanel({
  projectId,
}: {
  projectId: string;
}) {
  const client = useQueryClient();
  const [pairingSetup, setPairingSetup] = useState<PairingSetup | null>(null);
  const [retryStoreId, setRetryStoreId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revokingNodeId, setRevokingNodeId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const agentsQuery = useQuery({
    queryKey: queryKey(projectId),
    queryFn: () => fetchNodes(projectId),
    enabled: !!projectId,
    retry: false,
    refetchInterval: 15_000,
  });
  const agents = agentsQuery.data ?? [];

  async function createPairing() {
    setError(null);
    setBusy(true);
    let storeId = retryStoreId;
    try {
      if (!storeId) {
        if (!globalThis.crypto?.randomUUID) {
          setError("هذا المتصفح لا يدعم إنشاء هوية مخزن آمنة.");
          return;
        }
        storeId = globalThis.crypto.randomUUID();
        setRetryStoreId(storeId);
      }
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/preview-agents/pairings`,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ storeId }),
        },
      );
      if (!response.ok) {
        if (response.status < 500) setRetryStoreId(null);
        throw await responseError(response);
      }
      const body: unknown = await response.json();
      if (
        !isRecord(body) ||
        typeof body.nodeId !== "string" ||
        body.storeId !== storeId ||
        typeof body.pairingCode !== "string" ||
        typeof body.expiresAt !== "string" ||
        !Number.isFinite(new Date(body.expiresAt).getTime())
      ) {
        throw new Error("استجابة الاقتران غير مكتملة؛ حدّث قائمة الأجهزة.");
      }
      setPairingSetup({
        nodeId: body.nodeId,
        storeId,
        pairingCode: body.pairingCode,
        expiresAt: body.expiresAt,
      });
      setRetryStoreId(null);
      await client.invalidateQueries({ queryKey: queryKey(projectId) });
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? "لم يصل رد مؤكد من الخادم. أعد المحاولة؛ سيستخدم الطلب الهوية نفسها."
          : cause instanceof Error
            ? cause.message
            : "تعذر إنشاء طلب الاقتران. أعد المحاولة؛ سيستخدم الطلب الهوية نفسها.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(node: PreviewAgentNode) {
    if (
      !window.confirm(
        "سيُلغى اقتران هذا الجهاز، ولن تقبل الخوادم نبضاته اللاحقة. هل تريد المتابعة؟",
      )
    ) {
      return;
    }
    setError(null);
    setRevokingNodeId(node.nodeId);
    try {
      const response = await fetch(
        `/api/projects/${encodeURIComponent(projectId)}/preview-agents/${encodeURIComponent(node.nodeId)}/revoke`,
        {
          method: "POST",
          credentials: "include",
          cache: "no-store",
        },
      );
      if (!response.ok) throw await responseError(response);
      await client.invalidateQueries({ queryKey: queryKey(projectId) });
      if (pairingSetup?.nodeId === node.nodeId) setPairingSetup(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "تعذر إلغاء اقتران الجهاز.",
      );
    } finally {
      setRevokingNodeId(null);
    }
  }

  return (
    <section className="workspace-card" aria-labelledby="preview-agent-heading">
      <div className="workspace-card-heading">
        <div className="workspace-card-icon runtime">
          <KeyRound className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="preview-agent-heading">أجهزة Preview المحلية</h2>
          <p>إدارة الهوية والاقتران؛ لا يعني ذلك أن الجهاز متصل أو مؤهل للتنفيذ.</p>
        </div>
        <button
          type="button"
          onClick={() => void agentsQuery.refetch()}
          disabled={agentsQuery.isFetching}
          className="workspace-refresh"
          aria-label="تحديث أجهزة Preview"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${agentsQuery.isFetching ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs leading-5 text-slate-400">
          الاقتران يثبت هوية الجهاز فقط. لا يشغّل Candidate ولا يمنح وصولًا إلى ملفات المشروع.
        </p>
        <button
          type="button"
          onClick={() => void createPairing()}
          disabled={busy || !projectId}
          className="workspace-retry disabled:cursor-not-allowed disabled:opacity-50"
        >
          <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
          {busy
            ? "جارٍ إنشاء الطلب…"
            : retryStoreId
              ? "إعادة محاولة الاقتران"
              : "ربط جهاز Linux"}
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-red-400/25 bg-red-300/[.06] px-3 py-2 text-xs leading-5 text-red-100/90" role="alert">
          {error}
        </p>
      )}

      {pairingSetup && (
        <PairingCode
          setup={pairingSetup}
          onExpire={() => setPairingSetup(null)}
        />
      )}

      {agentsQuery.isLoading ? (
        <p className="mt-4 text-xs text-slate-500" role="status">جارٍ تحميل الأجهزة…</p>
      ) : agentsQuery.isError ? (
        <p className="mt-4 text-xs leading-5 text-amber-100/80" role="status">
          تعذر قراءة الأجهزة. أعد المحاولة؛ لا يمكن تأكيد غياب اقترانات سابقة.
        </p>
      ) : agents.length === 0 ? (
        <div className="workspace-empty compact">
          <p className="font-medium text-slate-300">لا توجد أجهزة مقترنة لهذا المشروع</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">يظهر الجهاز هنا بعد إنشاء طلب اقتران أو ربطه.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-2">
          {agents.map((agent) => (
            <li key={agent.nodeId} className="workspace-task">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`workspace-status status-${agent.status}`}>
                    {statusLabels[agent.status]}
                  </span>
                  <span className="text-xs text-slate-300">
                    Linux Agent <bdi dir="ltr">{agent.nodeId.slice(0, 8)}</bdi>
                  </span>
                </div>
                <p className="mt-1.5 text-[11px] text-slate-500">
                  {agent.lastSeenAt
                    ? `آخر نبضة مسجلة: ${formatDate(agent.lastSeenAt)}`
                    : agent.status === "pending"
                      ? `ينتهي الطلب: ${formatDate(agent.pairingExpiresAt)}`
                      : "لم تُسجل نبضة بعد"}
                </p>
                {agent.publicKeyFingerprint && (
                  <p className="mt-1 break-all text-[10px] text-slate-600" dir="ltr">
                    SHA-256: {agent.publicKeyFingerprint}
                  </p>
                )}
              </div>
              {agent.status !== "revoked" && (
                <button
                  type="button"
                  onClick={() => void revoke(agent)}
                  disabled={revokingNodeId === agent.nodeId}
                  className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-300/20 px-2 py-1.5 text-[11px] text-red-200 hover:bg-red-300/[.08] disabled:opacity-50"
                  aria-label={`إلغاء اقتران الجهاز ${agent.nodeId.slice(0, 8)}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                  {revokingNodeId === agent.nodeId ? "جارٍ الإلغاء" : "إلغاء"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
