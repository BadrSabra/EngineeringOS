# Raw audit records

- Session: 20f36918-25c4-495b-bdf5-0eacbe97db45
- Execution: fc9a9ee2-3402-4fbc-a95d-1e75e37b404f
- Captured: 2026-09-19T21:04:55.607Z

## session

```text
id,project_id,title,linked_task_id,active_task_state,created_at,updated_at
20f36918-25c4-495b-bdf5-0eacbe97db45,7121328e-5960-4dae-b67e-221c90fee498,أشرح وحلل طبقات الذكاء الاصطناعي داخل المشروع,,"{""version"":1,""taskType"":""BEHAVIOR_QUERY"",""outputContract"":""BEHAVIOR_ANSWER"",""contextProfile"":""chat-normal"",""operationId"":""fc9a9ee2-3402-4fbc-a95d-1e75e37b404f"",""executionId"":""fc9a9ee2-3402-4fbc-a95d-1e75e37b404f"",""scope"":{""projectId"":""7121328e-5960-4dae-b67e-221c90fee498"",""rootPath"":""/home/runner/workspace/.engineeringos-projects/89985182-065a-467a-99bb-a8304f321754"",""linkedTaskId"":null,""revision"":""unscanned:2026-09-18T01:46:38.616Z""},""evidence"":{""readFiles"":[""artifacts/api-server/src/routes/ai/chat.ts"",""lib/ai-orchestrator/src/turn-intent.ts"",""lib/ai-orchestrator/src/project-query-target.ts"",""lib/ai-orchestrator/src/agents/query-planner.ts"",""lib/ai-orchestrator/src/evidence-integrity.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts"",""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""lib/ai-orchestrator/src/agents/chat-agent.ts"",""lib/db/src/schema/ai_chats.ts""]},""projectQuery"":{""id"":""embedded-ai"",""label"":""embedded AI layer"",""firstEvidencePath"":""artifacts/api-server/src/routes/ai/chat.ts"",""primaryPaths"":[""artifacts/api-server/src/routes/ai/chat.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts"",""artifacts/api-server/src/lib/ai-execution-acceptance.ts"",""lib/ai-orchestrator/src/turn-intent.ts"",""lib/ai-orchestrator/src/agents/chat-agent.ts""],""allowedExpansionPaths"":[""lib/ai-orchestrator/src"",""lib/db/src/schema"",""artifacts/api-server/src/routes/ai"",""artifacts/api-server/src/lib""],""forbiddenPaths"":[""node_modules"",""dist"",""build""],""requiredEvidencePaths"":[""artifacts/api-server/src/routes/ai/chat.ts"",""lib/ai-orchestrator/src/turn-intent.ts"",""lib/ai-orchestrator/src/agents/chat-agent.ts"",""lib/ai-orchestrator/src/project-query-target.ts"",""lib/ai-orchestrator/src/agents/query-planner.ts"",""lib/ai-orchestrator/src/evidence-integrity.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts"",""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""lib/db/src/schema/ai_chats.ts""],""requiredClaims"":[{""claimId"":""ai-routing"",""text"":""The chat route resolves the turn intent before selecting the execution path."",""requiredEvidencePaths"":[""artifacts/api-server/src/routes/ai/chat.ts"",""lib/ai-orchestrator/src/turn-intent.ts""],""evidenceNeedles"":[""resolveTurnIntent"",""turnIntent""]},{""claimId"":""ai-tool-loop"",""text"":""The tool-enabled chat execution enters executeToolLoop and retains its tool results before synthesis."",""requiredEvidencePaths"":[""lib/ai-orchestrator/src/agents/chat-agent.ts""],""evidenceNeedles"":[""executeToolLoop"",""loopResult""]},{""claimId"":""ai-provider-dispatch"",""text"":""The route dispatches provider requests through chatWithFallback before final response validation."",""requiredEvidencePaths"":[""artifacts/api-server/src/routes/ai/chat.ts""],""evidenceNeedles"":[""chatWithFallback"",""provider""]},{""claimId"":""ai-query-planning"",""text"":""The project-query target and planner turn the request into bounded required claims, evidence paths, and compound analysis parts before source reads."",""requiredEvidencePaths"":[""lib/ai-orchestrator/src/project-query-target.ts"",""lib/ai-orchestrator/src/agents/query-planner.ts""],""evidenceNeedlesByPath"":{""lib/ai-orchestrator/src/project-query-target.ts"":[""buildProjectQueryObjective"",""requiredClaims""],""lib/ai-orchestrator/src/agents/query-planner.ts"":[""compoundParts"",""subQueries""]}},{""claimId"":""ai-evidence-acceptance"",""text"":""The server-owned evidence and objective gates require retained evidence, closed claims, and a validated final answer before the project analysis is proven."",""requiredEvidencePaths"":[""lib/ai-orchestrator/src/evidence-integrity.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts""],""evidenceNeedlesByPath"":{""lib/ai-orchestrator/src/evidence-integrity.ts"":[""objectiveCompletionGate"",""validateFinalAnswer""],""artifacts/api-server/src/lib/ai-execution-state.ts"":[""validateAnalysisEvidenceCompletion""]}},{""claimId"":""ai-durable-execution"",""text"":""The API route creates and checkpoints a durable AI execution so execution identity, evidence, and resumable state survive beyond the provider call."",""requiredEvidencePaths"":[""artifacts/api-server/src/routes/ai/chat.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts""],""evidenceNeedlesByPath"":{""artifacts/api-server/src/routes/ai/chat.ts"":[""createAiExecution"",""checkpointAiExecution""],""artifacts/api-server/src/lib/ai-execution-state.ts"":[""checkpointAiExecution"",""claimAiExecution""]}},{""claimId"":""ai-terminal-projection-parity"",""text"":""Direct JSON, streamed SSE, persisted messages, and history reloads use the same server-owned session and terminal outcome identity."",""requiredEvidencePaths"":[""artifacts/api-server/src/routes/ai/chat.ts"",""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""lib/db/src/schema/ai_chats.ts""],""evidenceNeedlesByPath"":{""artifacts/api-server/src/routes/ai/chat.ts"":[""serializeAiSseEvent"",""persistFailedChatTurn"",""terminalProjection""],""artifacts/api-server/src/lib/ai-terminal-outcome.ts"":[""AiTerminalProjection"",""outcome""],""lib/db/src/schema/ai_chats.ts"":[""sessionId"",""outcome"",""executionId""]}}],""promptHint"":""Targeted project analysis: analyze the embedded AI layer end to end. Read and explicitly cover the server-owned behavioral claims for routing, the tool loop, provider dispatch, and acceptance with their source paths before synthesizing. Prove the retained production execution edges for intent routing, tool execution, provider dispatch, synthesis/finalization, and final validation before calling the answer proven. For an explicit layers or architecture request, also cover query planning, evidence acceptance, durable execution/checkpoints, and terminal projection across JSON, SSE, persistence, and history. State each claim assertion verbatim, then explain the sequence in the requested language. If the goal asks for weaknesses, also state the verified weakness claim about finish_reason=\""error\"" and explain why it must be rejected before tool execution. Separate verified weakness evidence from hypotheses. Do not stop at a symbol inventory, one provider client, or a generic project-access explanation."",""confidence"":0.98},""executionPlan"":null,""startedAt"":""2026-09-19T21:01:04.764Z"",""lastProgressAt"":""2026-09-19T21:01:04.764Z""}",2026-09-19T21:01:04.763Z,2026-09-19T21:01:04.764Z

```

## messages

```text
id,session_id,role,content,sources,tool_trace,repair_plan_metadata,behavior_evidence,mission_correlation_report,turn_intent,execution_id,outcome,error_code,error_message,task_result,created_at
3611e0ea-063a-4475-8e38-406984227283,20f36918-25c4-495b-bdf5-0eacbe97db45,user,أشرح وحلل طبقات الذكاء الاصطناعي داخل المشروع,,,,,,PROJECT_QUERY,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,,,,,2026-09-19T21:01:04.763Z
21dc62b1-2277-44c2-ad07-7dec64eca312,20f36918-25c4-495b-bdf5-0eacbe97db45,assistant,"## كيف يعمل وكيل الذكاء الاصطناعي داخل المشروع؟

باختصار، يمر الوكيل من فهم السؤال إلى اختيار مسار التنفيذ، ثم جمع الأدلة من الكود، ثم إرسال الطلب للمزود، وأخيراً صياغة إجابة مرتبطة بما تم التحقق منه. في هذا التحليل لم تُعدّل أي ملفات.

### الدورة العملية
أولاً، يستقبل مسار الدردشة الرسالة ويحدد نيتها قبل أن يختار نوع التنفيذ المناسب. لذلك يُعامل سؤال عن بنية المشروع كسؤال يحتاج قراءة وتحليلاً، لا كرسالة محادثة عامة فقط.
ثم، عندما يحتاج المسار إلى قراءة ملفات أو استخدام أدوات، يدخل الوكيل حلقة الأدوات. تحتفظ الحلقة بنتائج القراءات لكي يعتمد عليها التوليف اللاحق بدلاً من الاعتماد على ذاكرة المزود أو تخمينه.
بعد ذلك، يرسل مسار الدردشة طلب المزود عبر `chatWithFallback`. هذا يتيح اختيار مزود بديل عند الحاجة، بينما تبقى القراءات المحتفظ بها هي الأساس الذي يجب أن يلتزم به الرد النهائي.
وبالتوازي، يحول target الخاص باستعلام المشروع السؤال إلى claims ومسارات أدلة وأجزاء تحليل محددة قبل بدء قراءات المصدر، حتى لا يظل نطاق التحليل ضمنياً.
بعد جمع القراءات، تتحقق بوابة الأدلة من إغلاق كل claim ومن سلامة مسارات الإثبات ومن صحة الإجابة النهائية قبل إعلان التحليل مثبتاً.
ويحفظ مسار API هوية التنفيذ ونقاط checkpoint في الحالة الدائمة، لذلك يمكن تتبع الأدلة واستئناف التنفيذ دون الاعتماد على استدعاء المزود وحده.
وأخيراً، تُسقط النتيجة النهائية نفسها عبر JSON وSSE والرسائل المحفوظة وإعادة تحميل السجل، مع الحفاظ على هوية الجلسة والتنفيذ والنتيجة الطرفية.

### ماذا تم التحقق منه؟
النقاط التالية هي الأساس التقني للشرح، وقد تم ربط كل نقطة بقراءة مكتملة من المصدر:
- The chat route resolves the turn intent before selecting the execution path. — المصدر: `artifacts/api-server/src/routes/ai/chat.ts`، الأسطر 6011-6017
- The tool-enabled chat execution enters executeToolLoop and retains its tool results before synthesis. — المصدر: `lib/ai-orchestrator/src/agents/chat-agent.ts`، الأسطر 8152-8158
- The route dispatches provider requests through chatWithFallback before final response validation. — المصدر: `artifacts/api-server/src/routes/ai/chat.ts`، الأسطر 5235-5241
- The project-query target and planner turn the request into bounded required claims, evidence paths, and compound analysis parts before source reads. — المصدر: `lib/ai-orchestrator/src/project-query-target.ts`، الأسطر 471-477
- The server-owned evidence and objective gates require retained evidence, closed claims, and a validated final answer before the project analysis is proven. — المصدر: `lib/ai-orchestrator/src/evidence-integrity.ts`، الأسطر 1882-1888
- The API route creates and checkpoints a durable AI execution so execution identity, evidence, and resumable state survive beyond the provider call. — المصدر: `artifacts/api-server/src/routes/ai/chat.ts`، الأسطر 6735-6741
- Direct JSON, streamed SSE, persisted messages, and history reloads use the same server-owned session and terminal outcome identity. — المصدر: `artifacts/api-server/src/routes/ai/chat.ts`، الأسطر 6036-6042

### المصادر
- `artifacts/api-server/src/routes/ai/chat.ts:6011-6017`
- `lib/ai-orchestrator/src/agents/chat-agent.ts:8152-8158`
- `artifacts/api-server/src/routes/ai/chat.ts:5235-5241`
- `lib/ai-orchestrator/src/project-query-target.ts:471-477`
- `lib/ai-orchestrator/src/evidence-integrity.ts:1882-1888`
- `artifacts/api-server/src/routes/ai/chat.ts:6735-6741`
- `artifacts/api-server/src/routes/ai/chat.ts:6036-6042`

### حدود الشرح
يثبت هذا التحليل سلوك الكود داخل نوافذ المصدر المقروءة. لا يثبت وحده قابلية الوصول الإنتاجية أو سلوكاً لم يظهر في هذه القراءات.","[""lib/ai-orchestrator/src/turn-intent.ts"",""lib/ai-orchestrator/src/project-query-target.ts"",""lib/ai-orchestrator/src/agents/query-planner.ts"",""lib/ai-orchestrator/src/evidence-integrity.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts"",""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""artifacts/api-server/src/routes/ai/chat.ts"",""lib/ai-orchestrator/src/agents/chat-agent.ts"",""lib/db/src/schema/ai_chats.ts""]","[{""kind"":""diagnostic"",""code"":""OBJECTIVE_DECOMPOSED"",""details"":[""objective:PROJECT_QUERY_EMBEDDED-AI"",""objective:ai-routing"",""objective:ai-tool-loop"",""objective:ai-query-planning""]},{""kind"":""tool_call"",""tool"":""read_file"",""args"":{""path"":""artifacts/api-server/src/routes/ai/chat.ts""},""cached"":false,""prefetched"":true},{""kind"":""tool_result"",""tool"":""read_file"",""source"":""artifacts/api-server/src/routes/ai/chat.ts"",""cached"":false,""readStatus"":""READ_TRUNCATED"",""prefetched"":true},{""kind"":""diagnostic"",""code"":""FIRST_EVIDENCE_READ_ALLOWED"",""details"":[""target=artifacts/api-server/src/routes/ai/chat.ts"",""traversal=BROAD"",""action=EXPLORE""]},{""kind"":""tool_call"",""tool"":""read_file"",""args"":{""path"":""lib/ai-orchestrator/src/turn-intent.ts""},""cached"":false,""prefetched"":true},{""kind"":""tool_result"",""tool"":""read_file"",""source"":""lib/ai-orchestrator/src/turn-intent.ts"",""cached"":false,""readStatus"":""READ_COMPLETE"",""prefetched"":true},{""kind"":""tool_call"",""tool"":""read_file"",""args"":{""path"":""lib/ai-orchestrator/src/project-query-target.ts""},""cached"":false,""prefetched"":true},{""kind"":""tool_result"",""tool"":""read_file"",""source"":""lib/ai-orchestrator/src/project-query-target.ts"",""cached"":false,""readStatus"":""READ_COMPLETE"",""prefetched"":true},{""kind"":""tool_call"",""tool"":""read_file"",""args"":{""path"":""lib/ai-orchestrator/src/agents/query-planner.ts""},""cached"":false,""prefetched"":true},{""kind"":""tool_result"",""tool"":""read_file"",""source"":""lib/ai-orchestrator/src/agents/query-planner.ts"",""cached"":false,""readStatus"":""READ_COMPLETE"",""prefetched"":true},{""kind"":""tool_call"",""tool"":""read_file"",""args"":{""path"":""lib/ai-orchestrator/src/evidence-integrity.ts""},""cached"":false,""prefetched"":true},{""kind"":""tool_result"",""tool"":""read_file"",""source"":""lib/ai-orchestrator/src/evidence-integrity.ts"",""cached"":false,""readStatus"":""READ_COMPLETE"",""prefetched"":true},{""kind"":""tool_call"",""tool"":""read_file"",""args"":{""path"":""artifacts/api-server/src/lib/ai-execution-state.ts""},""cached"":false,""prefetched"":true},{""kind"":""tool_result"",""tool"":""read_file"",""source"":""artifacts/api-server/src/lib/ai-execution-state.ts"",""cached"":false,""readStatus"":""READ_COMPLETE"",""prefetched"":true},{""kind"":""tool_call"",""tool"":""read_file"",""args"":{""path"":""artifacts/api-server/src/lib/ai-terminal-outcome.ts""},""cached"":false,""prefetched"":true},{""kind"":""tool_result"",""tool"":""read_file"",""source"":""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""cached"":false,""readStatus"":""READ_COMPLETE"",""prefetched"":true},{""kind"":""plan_activity"",""stage"":""plan"",""status"":""done"",""stepTitle"":""Created a task plan for this turn"",""resultSummary"":""decision=CREATE | source=new | steps=3 | plan=cc6b5864bbc9"",""nextStepTitle"":""Inspect the relevant project context""},{""kind"":""project_query_target"",""mode"":""resolved_target""},{""kind"":""iteration_start"",""iter"":0,""maxIterations"":30},{""kind"":""model_call""},{""kind"":""iteration_start"",""iter"":1,""maxIterations"":30},{""kind"":""model_call""},{""kind"":""iteration_start"",""iter"":2,""maxIterations"":30},{""kind"":""model_call""},{""kind"":""diagnostic"",""code"":""FORCE_PRIMARY_EVIDENCE_ACTION""},{""kind"":""tool_call"",""tool"":""read_file_range"",""args"":{""path"":""artifacts/api-server/src/routes/ai/chat.ts"",""startLine"":""5226"",""endLine"":""7568""},""cached"":false},{""kind"":""tool_result"",""tool"":""read_file_range"",""source"":""artifacts/api-server/src/routes/ai/chat.ts"",""cached"":false,""readStatus"":""READ_TARGETED"",""resultSummary"":""Read completed (96280 characters).""},{""kind"":""iteration_start"",""iter"":3,""maxIterations"":30},{""kind"":""model_call""},{""kind"":""diagnostic"",""code"":""FORCE_PRIMARY_EVIDENCE_ACTION""},{""kind"":""tool_call"",""tool"":""read_file_range"",""args"":{""path"":""lib/ai-orchestrator/src/agents/chat-agent.ts"",""startLine"":""8134"",""endLine"":""8996""},""cached"":false},{""kind"":""tool_result"",""tool"":""read_file_range"",""source"":""lib/ai-orchestrator/src/agents/chat-agent.ts"",""cached"":false,""readStatus"":""READ_TARGETED"",""resultSummary"":""Read completed (37016 characters).""},{""kind"":""iteration_start"",""iter"":4,""maxIterations"":30},{""kind"":""model_call""},{""kind"":""diagnostic"",""code"":""FORCE_PRIMARY_EVIDENCE_ACTION""},{""kind"":""diagnostic"",""code"":""JUSTIFIED_SCOPE_EXPANSION"",""details"":[""objective evidence scope expanded to lib/db/src/schema/ai_chats.ts"",""policy path: lib/db/src/schema""]},{""kind"":""tool_call"",""tool"":""read_file"",""args"":{""path"":""lib/db/src/schema/ai_chats.ts""},""cached"":false},{""kind"":""tool_result"",""tool"":""read_file"",""source"":""lib/db/src/schema/ai_chats.ts"",""cached"":false,""readStatus"":""READ_COMPLETE"",""resultSummary"":""Read completed (9719 characters).""},{""kind"":""iteration_start"",""iter"":5,""maxIterations"":30},{""kind"":""synthesis_start"",""iter"":5,""maxIterations"":30},{""kind"":""model_call""},{""kind"":""done"",""iterations"":6,""maxIterations"":30,""toolCalls"":9,""prefetchToolCalls"":6,""loopToolCalls"":3,""stopReason"":""response"",""synthesisStarted"":true,""synthesisAttempts"":1,""synthesisMaxAttempts"":2,""synthesisTimeoutMs"":30000,""synthesisElapsedMs"":3184,""diagnosticCodes"":[""OBJECTIVE_DECOMPOSED"",""FIRST_EVIDENCE_READ_ALLOWED"",""FORCE_PRIMARY_EVIDENCE_ACTION"",""JUSTIFIED_SCOPE_EXPANSION"",""PROJECT_QUERY_CLAIM_MATERIALIZATION"",""PROJECT_QUERY_NO_TOOLS_SYNTHESIS"",""PROJECT_QUERY_RESPONSE_BINDING"",""PROJECT_QUERY_OBJECTIVE_CLOSURE""],""diagnosticDetails"":[""objective:PROJECT_QUERY_EMBEDDED-AI"",""objective:ai-routing"",""objective:ai-tool-loop"",""objective:ai-query-planning""]},{""kind"":""diagnostic"",""code"":""PROJECT_QUERY_CLAIM_MATERIALIZATION"",""details"":[""manifestComplete=true"",""requiredClaims=7"",""materializedClaims=7"",""missingClaims=none""]},{""kind"":""diagnostic"",""code"":""PROJECT_QUERY_NO_TOOLS_SYNTHESIS"",""details"":[""retained 7 server-owned claim evidence windows""]},{""kind"":""evidence_integrity"",""code"":""TELEMETRY_CONSISTENT"",""consistent"":true,""violations"":[],""readAttempts"":9,""uniqueFilesRead"":9,""evidenceFileCount"":9,""acceptedEvidenceCount"":9,""completedReadFiles"":[""artifacts/api-server/src/routes/ai/chat.ts"",""lib/ai-orchestrator/src/agents/chat-agent.ts"",""lib/ai-orchestrator/src/turn-intent.ts"",""lib/ai-orchestrator/src/project-query-target.ts"",""lib/ai-orchestrator/src/agents/query-planner.ts"",""lib/ai-orchestrator/src/evidence-integrity.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts"",""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""lib/db/src/schema/ai_chats.ts""],""retainedBodyFiles"":[""artifacts/api-server/src/routes/ai/chat.ts"",""lib/ai-orchestrator/src/agents/chat-agent.ts"",""lib/ai-orchestrator/src/turn-intent.ts"",""lib/ai-orchestrator/src/project-query-target.ts"",""lib/ai-orchestrator/src/agents/query-planner.ts"",""lib/ai-orchestrator/src/evidence-integrity.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts"",""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""lib/db/src/schema/ai_chats.ts""],""acceptedEvidenceFiles"":[""artifacts/api-server/src/routes/ai/chat.ts"",""lib/ai-orchestrator/src/agents/chat-agent.ts"",""lib/ai-orchestrator/src/turn-intent.ts"",""lib/ai-orchestrator/src/project-query-target.ts"",""lib/ai-orchestrator/src/agents/query-planner.ts"",""lib/ai-orchestrator/src/evidence-integrity.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts"",""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""lib/db/src/schema/ai_chats.ts""],""acceptedClaimCount"":13,""acceptedBehavioralClaimCount"":7,""provenStructuralEdgeCount"":6,""provenRuntimeEdgeCount"":0,""objectiveType"":""PROJECT_QUERY_EMBEDDED-AI"",""requiredEdges"":[""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/turn-intent.ts#resolveTurnIntent"",""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/tool-execution-engine.ts#executeToolLoop"",""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/provider-strategy.ts#call"",""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/provider-strategy.ts#stream"",""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/agents/chat-agent.ts#finalizeObjectiveAndStream"",""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/evidence-integrity.ts#validateFinalAnswer""],""provenEdges"":[""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/turn-intent.ts#resolveTurnIntent"",""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/tool-execution-engine.ts#executeToolLoop"",""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/provider-strategy.ts#call"",""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/provider-strategy.ts#stream"",""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/agents/chat-agent.ts#finalizeObjectiveAndStream"",""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/evidence-integrity.ts#validateFinalAnswer""],""provenEdgeProofs"":[{""edge"":""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/turn-intent.ts#resolveTurnIntent"",""basis"":""SOURCE_AST""},{""edge"":""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/tool-execution-engine.ts#executeToolLoop"",""basis"":""SOURCE_AST""},{""edge"":""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/provider-strategy.ts#call"",""basis"":""SOURCE_AST""},{""edge"":""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/provider-strategy.ts#stream"",""basis"":""SOURCE_AST""},{""edge"":""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/agents/chat-agent.ts#finalizeObjectiveAndStream"",""basis"":""SOURCE_AST""},{""edge"":""lib/ai-orchestrator/src/agents/chat-agent.ts#chat->lib/ai-orchestrator/src/evidence-integrity.ts#validateFinalAnswer"",""basis"":""SOURCE_AST""}],""completionGateResult"":""PROVEN"",""finalAnswerType"":""BEHAVIORAL_ANSWER"",""scopeExpansions"":[],""unjustifiedReads"":[]},{""kind"":""diagnostic"",""code"":""PROJECT_QUERY_RESPONSE_BINDING"",""details"":[""overridePresent=true"",""overrideLength=3423"",""finalResponseLength=3423"",""responseUsesOverride=true""]},{""kind"":""diagnostic"",""code"":""PROJECT_QUERY_OBJECTIVE_CLOSURE"",""details"":[""acceptedEvidenceCount=7"",""gateStatus=PROVEN""]},{""kind"":""verification"",""verificationStage"":""VERIFIED_RESPONSE"",""responseLength"":3423,""sourceCount"":9,""evidenceCount"":7,""acceptedEvidenceCount"":9,""rejectionReasons"":[]},{""kind"":""decision_trace"",""taskType"":""BEHAVIOR_QUERY"",""allowedFiles"":[],""filesRead"":[""artifacts/api-server/src/routes/ai/chat.ts"",""lib/ai-orchestrator/src/agents/chat-agent.ts"",""lib/ai-orchestrator/src/turn-intent.ts"",""lib/ai-orchestrator/src/project-query-target.ts"",""lib/ai-orchestrator/src/agents/query-planner.ts"",""lib/ai-orchestrator/src/evidence-integrity.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts"",""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""lib/db/src/schema/ai_chats.ts""],""evidenceSelected"":13,""claim"":""BEHAVIOR_ANSWER"",""validator"":""AnswerValidator"",""rejectionReason"":[],""recoveryAttempt"":1,""finalState"":""VERIFIED"",""objectiveVerdict"":""ANSWER_COMPLETE""},{""kind"":""context_provenance"",""schemaVersion"":""1"",""intentKind"":""PROJECT_QUERY"",""revisionLabel"":""unscanned:2026-09-18T01:46:38.616Z"",""slices"":[{""layer"":""tasks"",""source"":""db:tasks"",""status"":""empty"",""freshness"":""missing"",""rowCount"":0,""truncated"":false,""admissionDecision"":""ADMIT"",""lifetimeStage"":""fresh""},{""layer"":""metrics"",""source"":""db:metrics"",""status"":""loaded"",""freshness"":""fresh"",""rowCount"":1,""truncated"":true,""admissionDecision"":""ADMIT"",""lifetimeStage"":""fresh""},{""layer"":""graphEntities"",""source"":""db:graph_entities"",""status"":""loaded"",""freshness"":""fresh"",""rowCount"":80,""truncated"":true,""admissionDecision"":""ADMIT"",""lifetimeStage"":""fresh""},{""layer"":""graphRelationships"",""source"":""db:graph_relationships"",""status"":""empty"",""freshness"":""missing"",""rowCount"":0,""truncated"":false,""admissionDecision"":""ADMIT"",""lifetimeStage"":""fresh""},{""layer"":""events"",""source"":""db:events"",""status"":""not_requested"",""freshness"":""missing"",""rowCount"":0,""truncated"":false,""admissionDecision"":""DROP"",""lifetimeStage"":""stale""},{""layer"":""workflows"",""source"":""db:workflows"",""status"":""not_requested"",""freshness"":""missing"",""rowCount"":0,""truncated"":false,""admissionDecision"":""DROP"",""lifetimeStage"":""fresh""}],""links"":{""returnedCount"":0,""truncated"":false,""statuses"":[],""details"":[]},""citations"":[]},{""kind"":""execution_ledger"",""id"":""fc9a9ee2-3402-4fbc-a95d-1e75e37b404f"",""mode"":""tool_chat"",""startedAt"":1789851664992,""deadlineAt"":1789851784992,""elapsedMs"":29511,""remainingMs"":90489,""budget"":{""deadlineMs"":120000,""modelCalls"":128,""providerAttempts"":192,""toolCalls"":360,""providerChanges"":4,""synthesisAttempts"":3,""recoveryAttempts"":8,""plannerCalls"":1,""hierarchicalTasks"":8},""counts"":{""model"":5,""provider_attempt"":8,""tool"":3,""planner"":1,""provider_change"":0,""synthesis"":1,""recovery"":0,""hierarchical_task"":0},""providers"":[""openrouter"",""OpenRouter""],""models"":[""poolside/laguna-s-2.1:free"",""cohere/north-mini-code:free"",""liquid/lfm-2.5-2.6b:free""],""terminalReason"":""completed""}]",,,,PROJECT_QUERY,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,SUCCEEDED,,,,2026-09-19T21:01:04.764Z

```

## execution

```text
id,project_id,session_id,operation_id,linked_task_id,build_plan_message_id,user_id,idempotency_key,correlation_id,attempt,resume_token_hash,request,checkpoint,checkpoint_version,status,worker_id,lease_until,last_heartbeat_at,cancel_requested_at,error,final_message_id,proposal_id,recipe_receipt,workspace_root,base_revision,created_at,updated_at,started_at,completed_at
fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,7121328e-5960-4dae-b67e-221c90fee498,20f36918-25c4-495b-bdf5-0eacbe97db45,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,,,user_3JTrV1mgwquwF2g7zv8r8JdqeQs,008fbccd-c24f-4368-a03c-c5f3d3d4164f,b1458402-cb5e-4766-8d2c-f5388f1a8c89,0,c195a7b8c5d42beff40a4922e9dc0ac898364debd767dabcf5c23f1f3c52cdc2,"{""projectId"":""7121328e-5960-4dae-b67e-221c90fee498"",""turnIntent"":""PROJECT_QUERY"",""sessionId"":""20f36918-25c4-495b-bdf5-0eacbe97db45"",""message"":""أشرح وحلل طبقات الذكاء الاصطناعي داخل المشروع"",""modelMessage"":""أشرح وحلل طبقات الذكاء الاصطناعي داخل المشروع"",""workspaceRevision"":""unscanned:2026-09-18T01:46:38.616Z"",""workspaceRoot"":""/home/runner/workspace/.engineeringos-projects/89985182-065a-467a-99bb-a8304f321754"",""objective"":{""objectiveType"":""PROJECT_QUERY_EMBEDDED-AI"",""requiredEvidencePaths"":[""artifacts/api-server/src/routes/ai/chat.ts"",""lib/ai-orchestrator/src/turn-intent.ts"",""lib/ai-orchestrator/src/agents/chat-agent.ts"",""lib/ai-orchestrator/src/project-query-target.ts"",""lib/ai-orchestrator/src/agents/query-planner.ts"",""lib/ai-orchestrator/src/evidence-integrity.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts"",""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""lib/db/src/schema/ai_chats.ts""],""requiredClaims"":[{""claimId"":""ai-routing"",""text"":""The chat route resolves the turn intent before selecting the execution path."",""requiredEvidencePaths"":[""artifacts/api-server/src/routes/ai/chat.ts"",""lib/ai-orchestrator/src/turn-intent.ts""],""evidenceNeedles"":[""resolveTurnIntent"",""turnIntent""]},{""claimId"":""ai-tool-loop"",""text"":""The tool-enabled chat execution enters executeToolLoop and retains its tool results before synthesis."",""requiredEvidencePaths"":[""lib/ai-orchestrator/src/agents/chat-agent.ts""],""evidenceNeedles"":[""executeToolLoop"",""loopResult""]},{""claimId"":""ai-provider-dispatch"",""text"":""The route dispatches provider requests through chatWithFallback before final response validation."",""requiredEvidencePaths"":[""artifacts/api-server/src/routes/ai/chat.ts""],""evidenceNeedles"":[""chatWithFallback"",""provider""]},{""claimId"":""ai-query-planning"",""text"":""The project-query target and planner turn the request into bounded required claims, evidence paths, and compound analysis parts before source reads."",""requiredEvidencePaths"":[""lib/ai-orchestrator/src/project-query-target.ts"",""lib/ai-orchestrator/src/agents/query-planner.ts""],""evidenceNeedlesByPath"":{""lib/ai-orchestrator/src/project-query-target.ts"":[""buildProjectQueryObjective"",""requiredClaims""],""lib/ai-orchestrator/src/agents/query-planner.ts"":[""compoundParts"",""subQueries""]}},{""claimId"":""ai-evidence-acceptance"",""text"":""The server-owned evidence and objective gates require retained evidence, closed claims, and a validated final answer before the project analysis is proven."",""requiredEvidencePaths"":[""lib/ai-orchestrator/src/evidence-integrity.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts""],""evidenceNeedlesByPath"":{""lib/ai-orchestrator/src/evidence-integrity.ts"":[""objectiveCompletionGate"",""validateFinalAnswer""],""artifacts/api-server/src/lib/ai-execution-state.ts"":[""validateAnalysisEvidenceCompletion""]}},{""claimId"":""ai-durable-execution"",""text"":""The API route creates and checkpoints a durable AI execution so execution identity, evidence, and resumable state survive beyond the provider call."",""requiredEvidencePaths"":[""artifacts/api-server/src/routes/ai/chat.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts""],""evidenceNeedlesByPath"":{""artifacts/api-server/src/routes/ai/chat.ts"":[""createAiExecution"",""checkpointAiExecution""],""artifacts/api-server/src/lib/ai-execution-state.ts"":[""checkpointAiExecution"",""claimAiExecution""]}},{""claimId"":""ai-terminal-projection-parity"",""text"":""Direct JSON, streamed SSE, persisted messages, and history reloads use the same server-owned session and terminal outcome identity."",""requiredEvidencePaths"":[""artifacts/api-server/src/routes/ai/chat.ts"",""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""lib/db/src/schema/ai_chats.ts""],""evidenceNeedlesByPath"":{""artifacts/api-server/src/routes/ai/chat.ts"":[""serializeAiSseEvent"",""persistFailedChatTurn"",""terminalProjection""],""artifacts/api-server/src/lib/ai-terminal-outcome.ts"":[""AiTerminalProjection"",""outcome""],""lib/db/src/schema/ai_chats.ts"":[""sessionId"",""outcome"",""executionId""]}}],""requiredEvidenceEdges"":[{""from"":""lib/ai-orchestrator/src/agents/chat-agent.ts#chat"",""to"":""lib/ai-orchestrator/src/turn-intent.ts#resolveTurnIntent"",""relationship"":""DIRECT_INVOCATION""},{""from"":""lib/ai-orchestrator/src/agents/chat-agent.ts#chat"",""to"":""lib/ai-orchestrator/src/tool-execution-engine.ts#executeToolLoop"",""relationship"":""DIRECT_INVOCATION""},{""from"":""lib/ai-orchestrator/src/agents/chat-agent.ts#chat"",""to"":""lib/ai-orchestrator/src/provider-strategy.ts#call"",""relationship"":""DIRECT_INVOCATION""},{""from"":""lib/ai-orchestrator/src/agents/chat-agent.ts#chat"",""to"":""lib/ai-orchestrator/src/provider-strategy.ts#stream"",""relationship"":""DIRECT_INVOCATION""},{""from"":""lib/ai-orchestrator/src/agents/chat-agent.ts#chat"",""to"":""lib/ai-orchestrator/src/agents/chat-agent.ts#finalizeObjectiveAndStream"",""relationship"":""DIRECT_INVOCATION""},{""from"":""lib/ai-orchestrator/src/agents/chat-agent.ts#chat"",""to"":""lib/ai-orchestrator/src/evidence-integrity.ts#validateFinalAnswer"",""relationship"":""DIRECT_INVOCATION""}],""scopePolicy"":{""primaryPaths"":[""artifacts/api-server/src/routes/ai/chat.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts"",""artifacts/api-server/src/lib/ai-execution-acceptance.ts"",""lib/ai-orchestrator/src/turn-intent.ts"",""lib/ai-orchestrator/src/agents/chat-agent.ts""],""allowedExpansionPaths"":[""lib/ai-orchestrator/src"",""lib/db/src/schema"",""artifacts/api-server/src/routes/ai"",""artifacts/api-server/src/lib""],""forbiddenPaths"":[""node_modules"",""dist"",""build""]},""goal"":""أشرح وحلل طبقات الذكاء الاصطناعي داخل المشروع""},""taskObjective"":{""version"":1,""kind"":""project_analysis"",""objective"":""أشرح وحلل طبقات الذكاء الاصطناعي داخل المشروع"",""validatorIds"":[""project-query-evidence.v1""],""requiredEvidence"":[""complete-source-reads"",""accepted-objective-claims""],""successCriteria"":[""Required source reads are complete for the declared scope."",""The objective claims and verdict are accepted from source evidence.""],""failureTaxonomy"":[""objective_not_proven"",""partial_evidence"",""revision_mismatch"",""scope_mismatch""],""projectId"":""7121328e-5960-4dae-b67e-221c90fee498"",""workspaceRevision"":""unscanned:2026-09-18T01:46:38.616Z"",""targetPaths"":[],""hash"":""5ebf1885929c42ff02f8442a1b18f7d59e1b3089c121abf793302a6580ae1b28""},""validationTargetPaths"":[],""proofRequired"":true,""resumeContract"":{""taskType"":""BEHAVIOR_QUERY"",""outputContract"":""BEHAVIOR_ANSWER"",""contextProfile"":""chat-normal"",""sessionId"":""20f36918-25c4-495b-bdf5-0eacbe97db45"",""projectRevision"":""unscanned:2026-09-18T01:46:38.616Z"",""requiresEvidence"":true,""scope"":{""projectId"":""7121328e-5960-4dae-b67e-221c90fee498"",""rootPath"":""/home/runner/workspace/.engineeringos-projects/89985182-065a-467a-99bb-a8304f321754"",""linkedTaskId"":null}}}","{""stage"":""completed"",""sequence"":52,""operation"":{""operationId"":""fc9a9ee2-3402-4fbc-a95d-1e75e37b404f"",""taskObjective"":{""version"":1,""kind"":""project_analysis"",""objective"":""أشرح وحلل طبقات الذكاء الاصطناعي داخل المشروع"",""validatorIds"":[""project-query-evidence.v1""],""requiredEvidence"":[""complete-source-reads"",""accepted-objective-claims""],""successCriteria"":[""Required source reads are complete for the declared scope."",""The objective claims and verdict are accepted from source evidence.""],""failureTaxonomy"":[""objective_not_proven"",""partial_evidence"",""revision_mismatch"",""scope_mismatch""],""projectId"":""7121328e-5960-4dae-b67e-221c90fee498"",""workspaceRevision"":""unscanned:2026-09-18T01:46:38.616Z"",""targetPaths"":[],""hash"":""5ebf1885929c42ff02f8442a1b18f7d59e1b3089c121abf793302a6580ae1b28""},""objective"":""{\""objectiveType\"":\""PROJECT_QUERY_EMBEDDED-AI\"",\""requiredEvidencePaths\"":[\""artifacts/api-server/src/routes/ai/chat.ts\"",\""lib/ai-orchestrator/src/turn-intent.ts\"",\""lib/ai-orchestrator/src/agents/chat-agent.ts\"",\""lib/ai-orchestrator/src/project-query-target.ts\"",\""lib/ai-orchestrator/src/agents/query-planner.ts\"",\""lib/ai-orchestrator/src/evidence-integrity.ts\"",\""artifacts/api-server/src/lib/ai-execution-state.ts\"",\""artifacts/api-server/src/lib/ai-terminal-outcome.ts\"",\""lib/db/src/schema/ai_chats.ts\""],\""requiredClaims\"":[{\""claimId\"":\""ai-routing\"",\""text\"":\""The chat route resolves the turn intent before selecting the execution path.\"",\""requiredEvidencePaths\"":[\""artifacts/api-server/src/routes/ai/chat.ts\"",\""lib/ai-orchestrator/src/turn-intent.ts\""],\""evidenceNeedles\"":[\""resolveTurnIntent\"",\""turnIntent\""]},{\""claimId\"":\""ai-tool-loop\"",\""text\"":\""The tool-enabled chat execution enters executeToolLoop and retains its tool results before synthesis.\"",\""requiredEvidencePaths\"":[\""lib/ai-orchestrator/src/agents/chat-agent.ts\""],\""evidenceNeedles\"":[\""executeToolLoop\"",\""loopResult\""]},{\""claimId\"":\""ai-provider-dispatch\"",\""text\"":\""The route dispatches provider requests through chatWithFallback before final response validation.\"",\""requiredEvidencePaths\"":[\""artifacts/api-server/src/routes/ai/chat.ts\""],\""evidenceNeedles\"":[\""chatWithFallback\"",\""provider\""]},{\""claimId\"":\""ai-query-planning\"",\""text\"":\""The project-query target and planner turn the request into bounded required claims, evidence paths, and compound analysis parts before source reads.\"",\""requiredEvidencePaths\"":[\""lib/ai-orchestrator/src/project-query-target.ts\"",\""lib/ai-orchestrator/src/agents/query-planner.ts\""],\""evidenceNeedlesByPath\"":{\""lib/ai-orchestrator/src/project-query-target.ts\"":[\""buildProjectQueryObjective\"",\""requiredClaims\""],\""lib/ai-orchestrator/src/agents/query-planner.ts\"":[\""compoundParts\"",\""subQueries\""]}},{\""claimId\"":\""ai-evidence-acceptance\"",\""text\"":\""The server-owned evidence and objective gates require retained evidence, closed claims, and a validated final answer before t"",""revisionManifest"":""unscanned:2026-09-18T01:46:38.616Z"",""planHash"":""c56d202767e61fbdce388babd89c19579f6fc6746291582ed2b3375cd1d9427d"",""policyRevision"":""server-policy-v1"",""candidateIdentity"":null,""targetPaths"":[],""expectedBehavior"":""أشرح وحلل طبقات الذكاء الاصطناعي داخل المشروع"",""acceptanceChecks"":[{""id"":""validation-passed"",""kind"":""validation"",""description"":""Registered validation passes for the approved scope."",""required"":true},{""id"":""evidence-bound"",""kind"":""evidence"",""description"":""Completion evidence is bound to this operation and revision."",""required"":true}],""state"":""succeeded"",""nodes"":[],""retryBudget"":3,""repairAttempts"":0,""evidenceRefs"":[],""updatedAt"":""2026-09-19T21:01:34.542Z""},""evidenceVerdict"":""PROVEN"",""evidenceRefs"":[""source-read:lib/ai-orchestrator/src/turn-intent.ts"",""source-read:lib/ai-orchestrator/src/project-query-target.ts"",""source-read:lib/ai-orchestrator/src/agents/query-planner.ts"",""source-read:lib/ai-orchestrator/src/evidence-integrity.ts"",""source-read:artifacts/api-server/src/lib/ai-execution-state.ts"",""source-read:artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""source-read:artifacts/api-server/src/routes/ai/chat.ts"",""source-read:lib/ai-orchestrator/src/agents/chat-agent.ts"",""source-read:lib/db/src/schema/ai_chats.ts""],""evidenceReason"":""Project analysis claims were accepted from source evidence bound to this revision."",""evidenceProgress"":{""operationId"":""fc9a9ee2-3402-4fbc-a95d-1e75e37b404f"",""sourceRevision"":""unscanned:2026-09-18T01:46:38.616Z"",""requiredPaths"":[""artifacts/api-server/src/routes/ai/chat.ts"",""lib/ai-orchestrator/src/turn-intent.ts"",""lib/ai-orchestrator/src/agents/chat-agent.ts"",""lib/ai-orchestrator/src/project-query-target.ts"",""lib/ai-orchestrator/src/agents/query-planner.ts"",""lib/ai-orchestrator/src/evidence-integrity.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts"",""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""lib/db/src/schema/ai_chats.ts""],""pathStatuses"":[{""path"":""artifacts/api-server/src/routes/ai/chat.ts"",""status"":""complete""},{""path"":""lib/ai-orchestrator/src/turn-intent.ts"",""status"":""complete""},{""path"":""lib/ai-orchestrator/src/agents/chat-agent.ts"",""status"":""complete""},{""path"":""lib/ai-orchestrator/src/project-query-target.ts"",""status"":""complete""},{""path"":""lib/ai-orchestrator/src/agents/query-planner.ts"",""status"":""complete""},{""path"":""lib/ai-orchestrator/src/evidence-integrity.ts"",""status"":""complete""},{""path"":""artifacts/api-server/src/lib/ai-execution-state.ts"",""status"":""complete""},{""path"":""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""status"":""complete""},{""path"":""lib/db/src/schema/ai_chats.ts"",""status"":""complete""}],""completedPaths"":[""artifacts/api-server/src/routes/ai/chat.ts"",""lib/ai-orchestrator/src/turn-intent.ts"",""lib/ai-orchestrator/src/agents/chat-agent.ts"",""lib/ai-orchestrator/src/project-query-target.ts"",""lib/ai-orchestrator/src/agents/query-planner.ts"",""lib/ai-orchestrator/src/evidence-integrity.ts"",""artifacts/api-server/src/lib/ai-execution-state.ts"",""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",""lib/db/src/schema/ai_chats.ts""],""missingPaths"":[]},""validatorReceipts"":[{""validatorId"":""project-query-evidence.v1"",""status"":""PROVEN"",""operationId"":""fc9a9ee2-3402-4fbc-a95d-1e75e37b404f"",""projectId"":""7121328e-5960-4dae-b67e-221c90fee498"",""workspaceRevision"":""unscanned:2026-09-18T01:46:38.616Z"",""artifactRef"":""analysis-evidence:fc9a9ee2-3402-4fbc-a95d-1e75e37b404f""}],""proofRequired"":true,""updatedAt"":""2026-09-19T21:01:34.542Z""}",52,completed,,,,,,21dc62b1-2277-44c2-ad07-7dec64eca312,,,/home/runner/workspace/.engineeringos-projects/89985182-065a-467a-99bb-a8304f321754,unscanned:2026-09-18T01:46:38.616Z,2026-09-19T21:01:04.839Z,2026-09-19T21:01:34.550Z,2026-09-19T21:01:04.845Z,2026-09-19T21:01:34.550Z

```

## acceptance

```text
id,execution_id,project_id,attempt,finalization_key,operation_id,worker_id,terminal_status,outcome,reason_code,next_action_code,disposition,evidence_snapshot_id,evidence_required,evidence_complete,resumable,message_id,source_revision,candidate_identity,created_at
dc9021e5-b318-4049-a54c-2a740750d8b6,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,7121328e-5960-4dae-b67e-221c90fee498,0,execution:fc9a9ee2-3402-4fbc-a95d-1e75e37b404f:attempt:0:completed,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,b50ee945-5ee8-4291-81e1-8dfa0870a4a3,completed,SUCCEEDED,ACCEPTED,NONE,"{""outcome"":""SUCCEEDED"",""reasonCodes"":[""ACCEPTED""],""recoveryState"":""NONE"",""taskObjective"":{""kind"":""project_analysis"",""status"":""PROVEN"",""validatorIds"":[""project-query-evidence.v1""]},""nextActionCode"":""NONE"",""operatorAction"":""NONE""}",8e78c54c-23e5-445e-85ec-6e3816154184,1,1,0,21dc62b1-2277-44c2-ad07-7dec64eca312,unscanned:2026-09-18T01:46:38.616Z,,2026-09-19T21:01:34.550Z

```

## snapshots

```text
id,execution_id,project_id,attempt,operation_id,source_revision,candidate_identity,verdict,complete,read_count,total_bytes,created_at
8e78c54c-23e5-445e-85ec-6e3816154184,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,7121328e-5960-4dae-b67e-221c90fee498,0,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,unscanned:2026-09-18T01:46:38.616Z,,PROVEN,1,9,504415,2026-09-19T21:01:34.550Z

```

## reads

```text
id,snapshot_id,path,read_type,line_start,line_end,content_hash,byte_length,complete,truncated,body,created_at
e55b5d77-6c2c-4e37-9727-9fbdbe0adf62,8e78c54c-23e5-445e-85ec-6e3816154184,artifacts/api-server/src/lib/ai-execution-state.ts,source,,,fbb47b0b95ec9bcb53059639fe04d0a2279a8ac46585c8b0953c19249294c9a7,119476,1,0,"File: artifacts/api-server/src/lib/ai-execution-state.ts
```
import { createHash, randomUUID } from ""node:crypto"";
import { and, eq, gt, inArray, lt, or, sql } from ""drizzle-orm"";
import { db, aiExecutionsTable, aiExecutionAcceptancesTable } from ""@workspace/db"";
import type { AiExecution } from ""@workspace/db"";
import type {
  ExecutionNode,
  FlightDeckEvidenceVerdict,
  RecipeReceipt,
  ValidationEvidence,
} from ""@workspace/ai-orchestrator"";
import {
  formatUntrustedContent,
  hasCompleteProjectOrientationSources,
} from ""@workspace/ai-orchestrator"";
import type { AiAcceptanceDisposition } from ""./ai-terminal-outcome.js"";
import {
  parseTaskObjectiveContract,
  parseTaskObjectiveValidatorReceipt,
  validateTaskObjectiveContract,
  type TaskObjectiveContract,
  type TaskObjectiveValidatorReceipt,
} from ""./task-objective-contract.js"";
import {
  finalizeExecutionAcceptance,
  type EvidenceReadInput,
  type EvidenceSnapshotInput,
} from ""./ai-execution-acceptance.js"";

export const AI_EXECUTION_LEASE_MS = 5 * 60 * 1000;
export const AI_EXECUTION_HEARTBEAT_INTERVAL_MS = Math.max(
  1_000,
  Math.floor(AI_EXECUTION_LEASE_MS / 3),
);
export const AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT = 12_000;
export const AI_EXECUTION_TRACE_LIMIT = 80;
export const AI_EXECUTION_NODE_LIMIT = 24;
export const AI_EXECUTION_NODE_FILES_LIMIT = 48;
const activeControllers = new Map<string, AbortController>();

/**
 * The durable operation state is intentionally separate from the provider
 * lifecycle status. `ai_executions.status` answers ""is a worker alive?"", while
 * this state answers ""which guarded operation stage owns the next action?""
 * Keeping both prevents a reconnect or provider response from being treated as
 * proof that a mutation, promotion, or delivery succeeded.
 */
export const AUTONOMOUS_OPERATION_STATES = [
  ""planned"",
  ""inspecting"",
  ""mutating"",
  ""validating"",
  ""diagnosing"",
  ""repairing"",
  ""promoting"",
  ""delivering"",
  ""succeeded"",
  ""failed"",
  ""cancelled"",
  ""blocked"",
  ""uncertain"",
] as const;
export type AutonomousOperationState = (typeof AUTONOMOUS_OPERATION_STATES)[number];
export type AutonomousOperationNodeKind =
  | ""inspect""
  | ""mutate""
  | ""validate""
  | ""diagnose""
  | ""repair""
  | ""promote""
  | ""delivery"";

export type AutonomousOperationNode = {
  id: string;
  kind: AutonomousOperationNodeKind;
  dependencies: string[];
  status: ""queued"" | ""running"" | ""passed"" | ""failed"" | ""blocked"";
  attempts: number;
  validationAttempts: number;
  allowedFiles: string[];
  validationProfile: string;
  evidenceRefs: string[];
};

export const RECIPE_OPERATION_PHASES = [
  ""planned"",
  ""queued"",
  ""running"",
  ""mutating"",
  ""validating"",
  ""completed"",
  ""failed"",
  ""cancelled"",
] as const;
export type RecipeOperationPhase = (typeof RECIPE_OPERATION_PHASES)[number];

export type RecipeOperationBudget = {
  maxNodes: number;
  maxParallelNodes: number;
  maxTotalTimeoutMs: number;
  maxProcessCount: number;
  maxOutputBytes: number;
};

export type RecipeOperationBinding = {
  projectId: string;
  operationId: string;
  sourceRevision: string;
  candidateIdentity: string | null;
  candidateWorkspace: string | null;
  approvedPaths: string[];
  phase: RecipeOperationPhase;
  leaseOwner: string | null;
  leaseUntil: string | null;
  missionBudget: RecipeOperationBudget;
  concurrencyBudget: {
    maxInFlightNodes: number;
    maxProcesses: number;
  };
};

export type RecipeBindingExpectation = {
  projectId?: string;
  operationId?: string;
  sourceRevision?: string;
  candidateIdentity?: string | null;
  candidateWorkspace?: string | null;
  leaseOwner?: string | null;
  phase?: RecipeOperationPhase;
  now?: Date;
  requireLease?: boolean;
  approvedPaths?: readonly string[];
};

export type RecipeBindingCheck = {
  allowed: boolean;
  reason:
    | ""allowed""
    | ""invalid_binding""
    | ""project_mismatch""
    | ""operation_mismatch""
    | ""revision_mismatch""
    | ""candidate_mismatch""
    | ""workspace_mismatch""
    | ""scope_mismatch""
    | ""phase_mismatch""
    | ""lease_owner_mismatch""
    | ""lease_expired""
    | ""budget_exceeded"";
  detail: string;
};

const RECIPE_PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))(?!\.\.?$).+$/;

function normalizedRecipePath(value: string): string {
  return value.trim().replaceAll(""\\"", ""/"").replace(/^(\.\/)+/, """");
}

function validRecipeBudget(value: unknown): value is RecipeOperationBudget {
  if (!value || typeof value !== ""object"") return false;
  const budget = value as Partial<RecipeOperationBudget>;
  return Number.isInteger(budget.maxNodes) && budget.maxNodes! >= 1 && budget.maxNodes! <= AI_EXECUTION_NODE_LIMIT
    && Number.isInteger(budget.maxParallelNodes) && budget.maxParallelNodes! >= 1 && budget.maxParallelNodes! <= 8
    && Number.isInteger(budget.maxTotalTimeoutMs) && budget.maxTotalTimeoutMs! >= 1 && budget.maxTotalTimeoutMs! <= 900_000
    && Number.isInteger(budget.maxProcessCount) && budget.maxProcessCount! >= 1 && budget.maxProcessCount! <= 24
    && Number.isInteger(budget.maxOutputBytes) && budget.maxOutputBytes! >= 1 && budget.maxOutputBytes! <= 8 * 1024 * 1024;
}

function parseRecipeOperationBinding(value: unknown): RecipeOperationBinding | undefined {
  if (!value || typeof value !== ""object"") return undefined;
  const candidate = value as Partial<RecipeOperationBinding> & {
    concurrencyBudget?: Partial<RecipeOperationBinding[""concurrencyBudget""]>;
  };
  const approvedPaths = Array.isArray(candidate.approvedPaths)
    ? candidate.approvedPaths.filter((item): item is string => typeof item === ""string"").map(normalizedRecipePath)
    : [];
  const leaseUntil = candidate.leaseUntil;
  const concurrencyBudget = candidate.concurrencyBudget;
  if (
    typeof candidate.projectId !== ""string"" || candidate.projectId.length < 1 || candidate.projectId.length > 160
    || typeof candidate.operationId !== ""string"" || candidate.operationId.length < 1 || candidate.operationId.length > 160
    || typeof candidate.sourceRevision !== ""string"" || candidate.sourceRevision.length < 1 || candidate.sourceRevision.length > 240
    || candidate.sourceRevision === ""unbound""
    || (candidate.candidateIdentity !== null && typeof candidate.candidateIdentity !== ""string"")
    || (candidate.candidateWorkspace !== null && typeof candidate.candidateWorkspace !== ""string"")
    || !RECIPE_OPERATION_PHASES.includes(candidate.phase as RecipeOperationPhase)
    || (candidate.leaseOwner !== null && typeof candidate.leaseOwner !== ""string"")
    || (leaseUntil !== null && typeof leaseUntil !== ""string"")
    || (leaseUntil !== null && Number.isNaN(Date.parse(leaseUntil)))
    || approvedPaths.length > 48
    || approvedPaths.some((item) => !RECIPE_PATH_PATTERN.test(item))
    || !validRecipeBudget(candidate.missionBudget)
    || !concurrencyBudget
    || !Number.isInteger(concurrencyBudget.maxInFlightNodes)
    || concurrencyBudget.maxInFlightNodes < 1 || concurrencyBudget.maxInFlightNodes > 8
    || !Number.isInteger(concurrencyBudget.maxProcesses)
    || concurrencyBudget.maxProcesses < 1 || concurrencyBudget.maxProcesses > 24
  ) return undefined;
  return {
    projectId: candidate.projectId,
    operationId: candidate.operationId,
    sourceRevision: candidate.sourceRevision,
    candidateIdentity: candidate.candidateIdentity ?? null,
    candidateWorkspace: candidate.candidateWorkspace ?? null,
    approvedPaths: [...new Set(approvedPaths)],
    phase: candidate.phase as RecipeOperationPhase,
    leaseOwner: candidate.leaseOwner ?? null,
    leaseUntil: leaseUntil ?? null,
    missionBudget: { ...candidate.missionBudget },
    concurrencyBudget: {
      maxInFlightNodes: concurrencyBudget.maxInFlightNodes,
      maxProcesses: concurrencyBudget.maxProcesses,
    },
  };
}

export function createRecipeOperationBinding(params: {
  projectId: string;
  operationId: string;
  sourceRevision: string;
  candidateIdentity?: string | null;
  candidateWorkspace?: string | null;
  approvedPaths?: readonly string[];
  phase?: RecipeOperationPhase;
  leaseOwner?: string | null;
  leaseUntil?: Date | string | null;
  missionBudget?: Partial<RecipeOperationBudget>;
  concurrencyBudget?: Partial<RecipeOperationBinding[""concurrencyBudget""]>;
}): RecipeOperationBinding {
  const binding = parseRecipeOperationBinding({
    projectId: params.projectId,
    operationId: params.operationId,
    sourceRevision: params.sourceRevision,
    candidateIdentity: params.candidateIdentity ?? null,
    candidateWorkspace: params.candidateWorkspace ?? null,
    approvedPaths: (params.approvedPaths ?? []).map(normalizedRecipePath),
    phase: params.phase ?? ""planned"",
    leaseOwner: params.leaseOwner ?? null,
    leaseUntil: params.leaseUntil instanceof Date ? params.leaseUntil.toISOString() : params.leaseUntil ?? null,
    missionBudget: {
      maxNodes: params.missionBudget?.maxNodes ?? AI_EXECUTION_NODE_LIMIT,
      maxParallelNodes: params.missionBudget?.maxParallelNodes ?? 3,
      maxTotalTimeoutMs: params.missionBudget?.maxTotalTimeoutMs ?? 900_000,
      maxProcessCount: params.missionBudget?.maxProcessCount ?? 24,
      maxOutputBytes: params.missionBudget?.maxOutputBytes ?? 8 * 1024 * 1024,
    },
    concurrencyBudget: {
      maxInFlightNodes: params.concurrencyBudget?.maxInFlightNodes ?? 3,
      maxProcesses: params.concurrencyBudget?.maxProcesses ?? 8,
    },
  });
  if (!binding) throw new Error(""Invalid server-owned recipe operation binding."");
  return binding;
}

export function checkRecipeOperationBinding(
  binding: RecipeOperationBinding,
  expected: RecipeBindingExpectation = {},
): RecipeBindingCheck {
  const parsed = parseRecipeOperationBinding(binding);
  if (!parsed) return { allowed: false, reason: ""invalid_binding"", detail: ""Recipe operation binding is invalid."" };
  if (expected.projectId !== undefined && parsed.projectId !== expected.projectId) {
    return { allowed: false, reason: ""project_mismatch"", detail: ""Recipe operation belongs to a different project."" };
  }
  if (expected.operationId !== undefined && parsed.operationId !== expected.operationId) {
    return { allowed: false, reason: ""operation_mismatch"", detail: ""Recipe operation identity does not match the durable execution."" };
  }
  if (expected.sourceRevision !== undefined && parsed.sourceRevision !== expected.sourceRevision) {
    return { allowed: false, reason: ""revision_mismatch"", detail: ""Recipe source revision is stale."" };
  }
  if (expected.candidateIdentity !== undefined && parsed.candidateIdentity !== expected.candidateIdentity) {
    return { allowed: false, reason: ""candidate_mismatch"", detail: ""Recipe candidate identity does not match the durable execution."" };
  }
  if (expected.candidateWorkspace !== undefined && parsed.candidateWorkspace !== expected.candidateWorkspace) {
    return { allowed: false, reason: ""workspace_mismatch"", detail: ""Recipe candidate workspace does not match the durable execution."" };
  }
  if (expected.phase !== undefined && parsed.phase !== expected.phase) {
    return { allowed: false, reason: ""phase_mismatch"", detail: ""Recipe operation is not in the required phase."" };
  }
  if (expected.leaseOwner !== undefined && parsed.leaseOwner !== expected.leaseOwner) {
    return { allowed: false, reason: ""lease_owner_mismatch"", detail: ""Recipe worker does not own the operation lease."" };
  }
  if (expected.approvedPaths !== undefined) {
    const approved = new Set(parsed.approvedPaths);
    const outside = expected.approvedPaths.map(normalizedRecipePath).find((item) => !approved.has(item));
    if (outside) return { allowed: false, reason: ""scope_mismatch"", detail: ""Recipe action is outside the approved path scope."" };
  }
  if (expected.requireLease && (!parsed.leaseOwner || !parsed.leaseUntil
    || Date.parse(parsed.leaseUntil) <= (expected.now ?? new Date()).getTime())) {
    return { allowed: false, reason: ""lease_expired"", detail: ""Recipe operation lease is missing or expired."" };
  }
  if (parsed.missionBudget.maxParallelNodes > parsed.concurrencyBudget.maxInFlightNodes
    || parsed.missionBudget.maxProcessCount > parsed.concurrencyBudget.maxProcesses) {
    return { allowed: false, reason: ""budget_exceeded"", detail: ""Recipe mission budget exceeds its concurrency budget."" };
  }
  return { allowed: true, reason: ""allowed"", detail: ""Recipe operation binding is authorized."" };
}

export function assertRecipeOperationBinding(binding: RecipeOperationBinding, expected: RecipeBindingExpectation = {}): void {
  const result = checkRecipeOperationBinding(binding, expected);
  if (!result.allowed) throw new Error(`Recipe operation binding rejected: ${result.reason}`);
}

export function assertRecipeNodeBinding(
  binding: RecipeOperationBinding,
  node: Pick<ExecutionNode, ""allowedFiles"" | ""validationProfile"" | ""executionContext"">,
  expected: RecipeBindingExpectation = {},
): void {
  assertRecipeOperationBinding(binding, expected);
  const approved = new Set(binding.approvedPaths);
  if (node.allowedFiles.map(normalizedRecipePath).some((file) => !approved.has(file))) {
    throw new Error(""Recipe node is outside the approved path scope."");
  }
  if (node.executionContext) {
    if (node.executionContext.projectId !== binding.projectId) throw new Error(""Recipe node belongs to a different project."");
    if (node.executionContext.revision !== binding.sourceRevision) throw new Error(""Recipe node belongs to a stale source revision."");
    if (node.executionContext.scope.paths.map(normalizedRecipePath).some((file) => !approved.has(file))) {
      throw new Error(""Recipe node context is outside the approved path scope."");
    }
  }
  if (!node.validationProfile.trim()) throw new Error(""Recipe node has no registered validation profile."");
}

export type AutonomousAcceptanceCheck = {
  id: string;
  kind: ""scope"" | ""behavior"" | ""validation"" | ""evidence"";
  description: string;
  required: boolean;
};

export type AutonomousOperationContract = {
  operationId: string;
  taskObjective?: TaskObjectiveContract;
  objective: string;
  revisionManifest: string;
  planHash: string;
  policyRevision: string;
  candidateIdentity: string | null;
  targetPaths: string[];
  expectedBehavior: string;
  acceptanceChecks: AutonomousAcceptanceCheck[];
  state: AutonomousOperationState;
  nodes: AutonomousOperationNode[];
  retryBudget: number;
  repairAttempts: number;
  evidenceRefs: string[];
  binding?: RecipeOperationBinding;
  updatedAt: string;
};

const OPERATION_TRANSITIONS: Record<AutonomousOperationState, readonly AutonomousOperationState[]> = {
  planned: [""inspecting"", ""blocked"", ""cancelled""],
  inspecting: [""mutating"", ""validating"", ""blocked"", ""cancelled"", ""failed""],
  mutating: [""validating"", ""blocked"", ""cancelled"", ""uncertain"", ""failed""],
  validating: [""succeeded"", ""diagnosing"", ""promoting"", ""blocked"", ""cancelled"", ""uncertain"", ""failed""],
  diagnosing: [""repairing"", ""blocked"", ""cancelled"", ""failed""],
  repairing: [""validating"", ""blocked"", ""cancelled"", ""uncertain"", ""failed""],
  promoting: [""delivering"", ""blocked"", ""cancelled"", ""uncertain"", ""failed""],
  delivering: [""succeeded"", ""blocked"", ""cancelled"", ""uncertain"", ""failed""],
  succeeded: [],
  failed: [],
  cancelled: [],
  blocked: [],
  uncertain: [],
};

export function transitionAutonomousOperation(
  operation: AutonomousOperationContract,
  nextState: AutonomousOperationState,
  evidenceRefs: readonly string[] = [],
  validatorReceipts: readonly TaskObjectiveValidatorReceipt[] = [],
): AutonomousOperationContract {
  if (operation.state === nextState) return operation;
  if (!OPERATION_TRANSITIONS[operation.state].includes(nextState)) {
    throw new Error(`Illegal autonomous operation transition: ${operation.state} -> ${nextState}`);
  }
  if ([""succeeded"", ""promoting"", ""delivering""].includes(nextState)
    && operation.nodes.some((node) => node.status === ""failed"" || node.status === ""blocked"")) {
    throw new Error(""Autonomous operation cannot advance with failed or blocked nodes."");
  }
  if (nextState === ""succeeded"") {
    const completion = validateAutonomousOperationCompletion(operation, {
      evidenceRefs,
      evidenceVerdict: ""PROVEN"",
      validatorReceipts,
    });
    if (!completion.allowed) {
      throw new Error(`Autonomous operation success is blocked: ${completion.reasons.join(""; "")}`);
    }
  }
  return {
    ...operation,
    state: nextState,
    evidenceRefs: [...new Set([...operation.evidenceRefs, ...evidenceRefs])].slice(0, 48),
    updatedAt: new Date().toISOString(),
  };
}

export type AutonomousOperationCompletionCheck = {
  allowed: boolean;
  reasons: string[];
  reasonCodes?: AutonomousAcceptanceReasonCode[];
};

export const AUTONOMOUS_ACCEPTANCE_REASON_CODES = [
  ""missing_objective"",
  ""unbound_revision"",
  ""missing_expected_behavior"",
  ""missing_acceptance_checks"",
  ""revision_mismatch"",
  ""candidate_mismatch"",
  ""invalid_acceptance_check"",
  ""node_not_passed"",
  ""missing_scope"",
  ""scope_mismatch"",
  ""missing_evidence"",
  ""verdict_not_proven"",
  ""operation_mismatch"",
  ""checkpoint_operation_mismatch"",
  ""evidence_operation_mismatch"",
  ""evidence_revision_mismatch"",
  ""evidence_candidate_mismatch"",
  ""task_objective_invalid"",
  ""task_objective_not_proven"",
  ""task_validator_unavailable"",
  ""task_evidence_incomplete"",
  ""task_revision_mismatch"",
  ""task_scope_mismatch"",
  ""task_validation_failed"",
] as const;
export type AutonomousAcceptanceReasonCode =
  (typeof AUTONOMOUS_ACCEPTANCE_REASON_CODES)[number];

/**
 * The terminal success contract for autonomous work. This is deliberately
 * server-side and receipt-oriented: a provider response or a completed worker
 * lease is not evidence that the requested bytes or behavior were accepted.
 */
export function validateAutonomousOperationCompletion(
  operation: AutonomousOperationContract,
  params: {
    evidenceRefs?: readonly string[];
    evidence?: readonly Pick<
      ValidationEvidence,
      ""evidenceId""
      | ""artifactRef""
      | ""operationId""
      | ""projectRevision""
      | ""candidateHash""
    >[];
    evidenceVerdict?: FlightDeckEvidenceVerdict;
    workspaceRevision?: string;
    candidateIdentity?: string | null;
    operationId?: string;
    checkpointOperationId?: string;
    validatorReceipts?: readonly TaskObjectiveValidatorReceipt[];
    nodeStates?: readonly Pick<AutonomousOperationNode, ""status"" | ""evidenceRefs"">[];
    requireProven?: boolean;
  } = {},
): AutonomousOperationCompletionCheck {
  const reasons: string[] = [];
  const reasonCodes: AutonomousAcceptanceReasonCode[] = [];
  const addReason = (code: AutonomousAcceptanceReasonCode, message: string): void => {
    if (!reasonCodes.includes(code)) reasonCodes.push(code);
    reasons.push(message);
  };
  if (operation.taskObjective) {
    const reviewReady = params.requireProven === false;
    const objectiveCheck = validateTaskObjectiveContract({
      contract: operation.taskObjective,
      workspaceRevision: params.workspaceRevision ?? operation.revisionManifest,
      objectiveValidated: reviewReady || params.evidenceVerdict === ""PROVEN"",
      operationId: params.operationId ?? operation.operationId,
      evidenceVerdict: reviewReady ? ""PROVEN"" : params.evidenceVerdict,
      evidenceComplete: reviewReady || params.evidenceVerdict === ""PROVEN"",
      targetPaths: operation.targetPaths,
      validatorReceipts: params.validatorReceipts,
    });
    objectiveCheck.codes.forEach((code, index) => {
      const mapped = code === ""validator_unavailable""
        ? ""task_validator_unavailable""
        : code === ""partial_evidence""
          ? ""task_evidence_incomplete""
          : code === ""revision_mismatch""
            ? ""task_revision_mismatch""
            : code === ""scope_mismatch""
              ? ""task_scope_mismatch""
              : code === ""validation_failed""
                ? ""task_validation_failed""
                : ""task_objective_not_proven"";
      addReason(mapped, objectiveCheck.reasons[index] ?? ""task objective is not accepted"");
    });
  }
  if (!operation.objective.trim()) addReason(""missing_objective"", ""objective is missing"");
  if (!operation.revisionManifest.trim() || operation.revisionManifest === ""unbound"") {
    addReason(""unbound_revision"", ""workspace revision is unbound"");
  }
  if (!operation.expectedBehavior.trim()) addReason(""missing_expected_behavior"", ""expected behavior is missing"");
  if (operation.acceptanceChecks.length === 0) addReason(""missing_acceptance_checks"", ""acceptance checks are missing"");
  if (params.workspaceRevision && operation.revisionManifest !== params.workspaceRevision) {
    addReason(""revision_mismatch"", ""workspace revision does not match the execution request"");
  }
  if (params.candidateIdentity !== undefined && operation.candidateIdentity !== params.candidateIdentity) {
    addReason(""candidate_mismatch"", ""candidate identity does not match the operation"");
  }
  if (params.operationId !== undefined && operation.operationId !== params.operationId) {
    addReason(""operation_mismatch"", ""operation identity does not match the durable execution"");
  }
  if (
    params.checkpointOperationId !== undefined
    && operation.operationId !== params.checkpointOperationId
  ) {
    addReason(""checkpoint_operation_mismatch"", ""checkpoint operation identity does not match the completion operation"");
  }
  const requiredChecks = operation.acceptanceChecks.filter((check) => check.required);
  if (requiredChecks.some((check) => !check.id || !check.description.trim())) {
    addReason(""invalid_acceptance_check"", ""acceptance checks are not executable"");
  }
  const nodes = params.nodeStates ?? operation.nodes;
  if (nodes.some((node) => node.status !== ""passed"")) addReason(""node_not_passed"", ""not all execution nodes passed"");
  const mutatingOperation = operation.nodes.some((node) =>
    [""mutate"", ""repair"", ""promote"", ""delivery""].includes(node.kind),
  );
  if (mutatingOperation && operation.targetPaths.length === 0) {
    addReason(""missing_scope"", ""mutating operation has no approved target scope"");
  }
  if (operation.targetPaths.length > 0) {
    const approved = new Set(operation.targetPaths);
    const outOfScope = operation.nodes
      .flatMap((node) => node.allowedFiles)
      .find((file) => !approved.has(file));
    if (outOfScope) addReason(""scope_mismatch"", ""execution node is outside approved target scope"");
  }
  const refs = [...new Set([
    ...operation.evidenceRefs,
    ...(params.evidenceRefs ?? []),
    ...nodes.flatMap((node) => node.evidenceRefs),
  ])];
  if (refs.length === 0) addReason(""missing_evidence"", ""required acceptance evidence is missing"");
  if (params.requireProven !== false && params.evidenceVerdict !== ""PROVEN"") {
    addReason(""verdict_not_proven"", `evidence verdict is ${params.evidenceVerdict ?? ""NOT_RECORDED""}`);
  }
  for (const evidence of params.evidence ?? []) {
    if (evidence.operationId !== operation.operationId) {
      addReason(""evidence_operation_mismatch"", ""validation evidence is not bound to the completion operation"");
    }
    if (evidence.projectRevision !== operation.revisionManifest) {
      addReason(""evidence_revision_mismatch"", ""validation evidence is not bound to the execution revision"");
    }
    if (
      operation.candidateIdentity !== null
      && evidence.candidateHash !== operation.candidateIdentity
    ) {
      addReason(""evidence_candidate_mismatch"", ""validation evidence is not bound to the operation candidate"");
    }
  }
  return {
    allowed: reasons.length === 0,
    reasons,
    ...(reasonCodes.length > 0 ? { reasonCodes } : {}),
  };
}

export type AnalysisEvidenceCompletion = {
  operationId: string;
  sourceRevision: string;
  requiredPaths: readonly string[];
  completedReadFiles: readonly string[];
  acceptedEvidenceFiles: readonly string[];
  readManifest?: readonly AnalysisEvidenceRead[];
  acceptedClaimCount: number;
  evidenceConsistent: boolean;
  completionGateResult?: string;
  objectiveVerdict?: string;
  finalState?: string;
  /**
   * Project-query answers must be behaviorally complete, not merely an
   * inventory of symbols found in source files.
   */
  finalAnswerType?: ""PRODUCTION_REACHABILITY_ANSWER"" | ""BEHAVIORAL_ANSWER"" | ""NO_ANSWER"";
  /**
   * These are copied from the same terminal trace used for acceptance. A
   * successful project query must not carry a generic forensic failure.
   */
  forensicTerminalKind?: string;
  forensicDiagnosticVerdict?: ""FINDING_PROVEN"" | ""NO_VERIFIED_FINDING"" | ""ANALYSIS_INCOMPLETE"";
};

export type AnalysisEvidenceRead = {
  path: string;
  status: ""READ_COMPLETE"" | ""READ_TARGETED"" | ""READ_TRUNCATED"" | ""READ_FAILED"";
  operationId: string;
  sourceRevision: string;
  contentHash: string;
  byteLength: number;
};

export type AnalysisEvidenceCompletionCheck = {
  allowed: boolean;
  reasons: string[];
};

/**
 * Read-backed project analysis has a different proof contract from delivery:
 * complete source reads are necessary, but accepted claims and the objective
 * completion gate must also close. This keeps source citations from being
 * mistaken for validation artifacts while still allowing analysis to finish
 * without a build validation run.
 */
export function validateAnalysisEvidenceCompletion(
  evidence: AnalysisEvidenceCompletion,
  expected: {
    operationId: string;
    sourceRevision: string;
  },
): AnalysisEvidenceCompletionCheck {
  const reasons: string[] = [];
  const normalizePath = (value: string): string =>
    value.trim().replaceAll(""\\"", ""/"").replace(/^(\.\/)+/, """").replace(/\/+$/, """");
  const completed = new Set(evidence.completedReadFiles.map(normalizePath));
  const required = [...new Set(evidence.requiredPaths.map(normalizePath).filter(Boolean))];
  const accepted = [...new Set(evidence.acceptedEvidenceFiles.map(normalizePath).filter(Boolean))];
  const manifest = new Map(
    (evidence.readManifest ?? [])
      .map((read) => [normalizePath(read.path), read] as const)
      .filter(([path]) => Boolean(path)),
  );
  const manifestCompleted = new Set(
    [...manifest.entries()]
      .filter(([, read]) => read.status === ""READ_COMPLETE"" || read.status === ""READ_TARGETED"")
      .map(([path]) => path),
  );
  if (evidence.operationId !== expected.operationId) {
    reasons.push(""analysis evidence is not bound to the execution operation"");
  }
  if (evidence.sourceRevision !== expected.sourceRevision) {
    reasons.push(""analysis evidence is not bound to the execution revision"");
  }
  if (manifest.size === 0) {
    reasons.push(""analysis evidence read manifest is missing"");
  }
  if (required.length === 0) reasons.push(""analysis objective has no required evidence paths"");
  const missingPaths = required.filter((path) => !completed.has(path) || !manifestCompleted.has(path));
  if (missingPaths.length > 0) {
    reasons.push(`required analysis source paths are missing: ${missingPaths.slice(0, 8).join("", "")}`);
  }
  const malformedManifest = [...manifest.entries()]
    .filter(([, read]) =>
      read.operationId !== expected.operationId
      || read.sourceRevision !== expected.sourceRevision
      || !/^[a-f0-9]{64}$/i.test(read.contentHash)
      || !Number.isInteger(read.byteLength)
      || read.byteLength < 0,
    )
    .map(([path]) => path);
  if (malformedManifest.length > 0) {
    reasons.push(`analysis evidence manifest is invalid: ${malformedManifest.slice(0, 8).join("", "")}`);
  }
  const unmanifestedCompleted = [...completed].filter((path) => !manifest.has(path));
  if (unmanifestedCompleted.length > 0) {
    reasons.push(`completed analysis reads are missing from the manifest: ${unmanifestedCompleted.slice(0, 8).join("", "")}`);
  }
  const acceptedWithoutCompleteRead = accepted.filter((path) =>
    !completed.has(path) || !manifestCompleted.has(path),
  );
  if (acceptedWithoutCompleteRead.length > 0) {
    reasons.push(
      `accepted analysis evidence is not backed by complete reads: ${acceptedWithoutCompleteRead.slice(0, 8).join("", "")}`,
    );
  }
  if (!evidence.evidenceConsistent) reasons.push(""analysis evidence telemetry is inconsistent"");
  if (evidence.acceptedClaimCount < 1) reasons.push(""no analysis claim has been accepted"");
  if (evidence.acceptedEvidenceFiles.length < 1) reasons.push(""no accepted analysis evidence file has been recorded"");
  if (evidence.completionGateResult !== ""PROVEN"") {
    reasons.push(`analysis completion gate is ${evidence.completionGateResult ?? ""NOT_RECORDED""}`);
  }
  if (evidence.objectiveVerdict !== ""ANSWER_COMPLETE"") {
    reasons.push(`analysis objective verdict is ${evidence.objectiveVerdict ?? ""NOT_RECORDED""}`);
  }
  if (evidence.finalState !== ""VERIFIED"") reasons.push(""analysis decision was not verified"");
  if (evidence.finalAnswerType !== ""BEHAVIORAL_ANSWER"") {
    reasons.push(`analysis final answer type is ${evidence.finalAnswerType ?? ""NOT_RECORDED""}`);
  }
  if (evidence.forensicTerminalKind) {
    reasons.push(`project analysis has a conflicting forensic terminal: ${evidence.forensicTerminalKind}`);
  }
  if (evidence.forensicDiagnosticVerdict === ""ANALYSIS_INCOMPLETE"") {
    reasons.push(""project analysis has an incomplete forensic diagnostic"");
  }
  return { allowed: reasons.length === 0, reasons };
}

export function assertAutonomousOperationIdentity(
  original: AutonomousOperationContract,
  candidate: AutonomousOperationContract,
): void {
  for (const key of [
    ""operationId"",
    ""objective"",
    ""revisionManifest"",
    ""planHash"",
    ""policyRevision"",
    ""candidateIdentity"",
    ""expectedBehavior"",
  ] as const) {
    if (original[key] !== candidate[key]) {
      throw new Error(`Autonomous operation identity changed: ${key}`);
    }
  }
  if (!sameStringArray(original.targetPaths, candidate.targetPaths)) {
    throw new Error(""Autonomous operation identity changed: targetPaths"");
  }
  if (JSON.stringify(original.acceptanceChecks) !== JSON.stringify(candidate.acceptanceChecks)) {
    throw new Error(""Autonomous operation acceptance checks changed without policy approval."");
  }
  if (candidate.retryBudget < 0 || candidate.repairAttempts < 0 || candidate.repairAttempts > candidate.retryBudget) {
    throw new Error(""Autonomous operation retry budget is invalid."");
  }
}

export type AiExecutionRequestEnvelope = {
  projectId: string;
  /** Immutable route intent used by terminal policy and reconnect projections. */
  turnIntent?: string;
  /** Server-owned source-backed project explanation contract. */
  projectOrientation?: boolean;
  /** Stable server-owned identity shared by all phases of one operation. */
  operationId?: string;
  capabilityProbe?: AiCapabilityProbeContract;
  /** Immutable resumable contract metadata, when this is a task execution. */
  resumeContract?: {
    taskType: string;
    outputContract: string;
    contextProfile: string;
    sessionId: string;
    projectRevision: string;
    requiresEvidence: boolean;
    capabilityProbe?: AiCapabilityProbeContract;
    orientationManifest?: AiOrientationRoleManifest;
    scope: {
      projectId: string;
      rootPath: string | null;
      linkedTaskId: string | null;
    };
  };
  sessionId?: string;
  message: string;
  modelMessage: string;
  /** Workspace revision captured when this durable analysis operation began. */
  workspaceRevision?: string;
  /** Server-owned managed project root used by source reads and validation. */
  workspaceRoot?: string | null;
  linkedTaskId?: string;
  buildPlanMessageId?: string;
  objective?: unknown;
  taskObjective?: TaskObjectiveContract;
  validationTargetPaths: string[];
  proofRequired?: boolean;
};

export type AiOrientationRoleManifest = {
  projectRevision: string;
  rootPath: string | null;
  paths: {
    purpose: string[];
    components: string[];
    primaryFlow: string[];
    uncertainty: string[];
  };
};

export type AiCapabilityProbeContract = {
  sourceFiles: string[];
  requiredClaims: string[];
  outputContract: string;
};

/**
 * A durable execution is resumable only when its immutable request carries a
 * server-owned continuation contract. Tool access or a non-CHAT turn intent
 * alone is not enough: a generic project question may use read tools without
 * having reusable evidence or an objective to continue.
 */
export function hasAiExecutionResumeContract(
  request: AiExecutionRequestEnvelope | undefined,
): boolean {
  if (!request || request.turnIntent === ""CHAT"") return false;
  if (
    request.resumeContract
    || request.capabilityProbe
    || request.buildPlanMessageId
    || (request.linkedTaskId && request.turnIntent === ""DELIVERY"")
  ) {
    return true;
  }
  // Keep legacy proof-required executions resumable even when they predate the
  // explicit resumeContract field. Generic PROJECT_QUERY requests remain
  // non-resumable because their proofRequired flag is false.
  return request.proofRequired === true;
}

export type AiCapabilityProbeProgress = {
  closedClaims: string[];
  pendingClaims: string[];
  completedGroups: string[];
  failedGroups: string[];
};

export type AiCapabilityProbeCheckpoint = AiCapabilityProbeContract & {
  status?: ""PENDING"" | ""COMPLETE"" | ""INCOMPLETE"";
  missingClaims?: string[];
  progress?: AiCapabilityProbeProgress;
  recoveryAttempted?: boolean;
  recoveryAttempt?: number;
  recoveryFailureKind?: string;
};

export type AiProviderAttemptCheckpoint = {
  provider: string;
  code: string;
};

export type AiEvidencePathStatus = ""missing"" | ""complete"" | ""targeted"" | ""truncated"" | ""failed"";

export type AiEvidenceProgressCheckpoint = {
  operationId: string;
  sourceRevision: string;
  requiredPaths: string[];
  pathStatuses: Array<{
    path: string;
    status: AiEvidencePathStatus;
  }>;
  completedPaths: string[];
  missingPaths: string[];
  nextRequiredPath?: string;
};

export type AiExecutionNodeCheckpoint = Pick<
  ExecutionNode,
  | ""id""
  | ""title""
  | ""status""
  | ""allowedFiles""
  | ""dependencies""
  | ""validationProfile""
  | ""attempts""
  | ""validationAttempts""
  | ""lastFailure""
> & {
  evidenceRefs?: string[];
};

export type AiExecutionCheckpoint = {
  stage:
    | ""queued""
    | ""running""
    | ""client_disconnected""
    | ""model_call""
    | ""tool_loop""
    | ""finalizing""
    | ""completed""
    | ""failed""
    | ""cancelled"";
  sequence: number;
  streamedPreview?: string;
  recentSteps?: Array<Record<string, unknown>>;
  nodeStates?: AiExecutionNodeCheckpoint[];
  currentNode?: string;
  completedNodes?: string[];
  evidenceVerdict?: FlightDeckEvidenceVerdict;
  evidenceReason?: string;
  evidenceProgress?: AiEvidenceProgressCheckpoint;
  orientationManifest?: AiOrientationRoleManifest;
  proofRequired?: boolean;
  capabilityProbe?: AiCapabilityProbeCheckpoint;
  providerAttempts?: AiProviderAttemptCheckpoint[];
  retryAfterMs?: number;
  retryAt?: string;
  acceptanceDisposition?: AiAcceptanceDisposition;
  detail?: string;
  operation?: AutonomousOperationContract;
  recipeBinding?: RecipeOperationBinding;
  validatorReceipts?: readonly TaskObjectiveValidatorReceipt[];
  updatedAt: string;
};

const AI_EXECUTION_CHECKPOINT_STAGES = new Set<AiExecutionCheckpoint[""stage""]>([
  ""queued"",
  ""running"",
  ""client_disconnected"",
  ""model_call"",
  ""tool_loop"",
  ""finalizing"",
  ""completed"",
  ""failed"",
  ""cancelled"",
]);

export function hashResumeToken(token: string): string {
  return createHash(""sha256"").update(token).digest(""hex"");
}

export function createResumeToken(): string {
  return randomUUID().replaceAll(""-"", """") + randomUUID().replaceAll(""-"", """");
}

export function createAutonomousOperationContract(params: {
  operationId: string;
  taskObjective?: TaskObjectiveContract;
  objective: string;
  revisionManifest?: string;
  planHash?: string;
  policyRevision?: string;
  candidateIdentity?: string | null;
  targetPaths?: string[];
  expectedBehavior?: string;
  acceptanceChecks?: AutonomousAcceptanceCheck[];
  nodes?: AutonomousOperationNode[];
  binding?: RecipeOperationBinding;
}): AutonomousOperationContract {
  const objective = params.objective.slice(0, 2_000);
  if (params.binding && params.binding.operationId !== params.operationId) {
    throw new Error(""Recipe operation binding identity does not match the operation."");
  }
  return {
    operationId: params.operationId,
    ...(params.taskObjective ? { taskObjective: params.taskObjective } : {}),
    objective,
    revisionManifest: (params.revisionManifest ?? ""unbound"").slice(0, 2_000),
    planHash: params.planHash ?? createHash(""sha256"").update(objective).digest(""hex""),
    policyRevision: params.policyRevision ?? ""server-policy-v1"",
    candidateIdentity: params.candidateIdentity ?? null,
    targetPaths: [...new Set((params.targetPaths ?? []).filter(Boolean))].slice(0, 48),
    expectedBehavior: (params.expectedBehavior ?? objective).slice(0, 2_000),
    acceptanceChecks: (params.acceptanceChecks ?? [
      {
        id: ""validation-passed"",
        kind: ""validation"",
        description: ""Registered validation passes for the approved scope."",
        required: true,
      },
      {
        id: ""evidence-bound"",
        kind: ""evidence"",
        description: ""Completion evidence is bound to this operation and revision."",
        required: true,
      },
    ]).slice(0, 12),
    state: ""planned"",
    nodes: params.nodes ?? [],
    retryBudget: 3,
    repairAttempts: 0,
    evidenceRefs: [],
    ...(params.binding ? { binding: params.binding } : {}),
    updatedAt: new Date().toISOString(),
  };
}

export function parseExecutionRequest(raw: string): AiExecutionRequestEnvelope | undefined {
  try {
    const value = JSON.parse(raw) as AiExecutionRequestEnvelope;
    if (
      !value ||
      typeof value.projectId !== ""string"" ||
      (value.operationId !== undefined && typeof value.operationId !== ""string"") ||
      (value.sessionId !== undefined && typeof value.sessionId !== ""string"") ||
      typeof value.message !== ""string"" ||
      typeof value.modelMessage !== ""string"" ||
      !Array.isArray(value.validationTargetPaths)
    ) {
      return undefined;
    }
    if (value.capabilityProbe !== undefined && !parseCapabilityProbeContract(value.capabilityProbe)) {
      return undefined;
    }
    if (value.resumeContract?.capabilityProbe !== undefined
      && !parseCapabilityProbeContract(value.resumeContract.capabilityProbe)) {
      return undefined;
    }
    const orientationManifest = value.resumeContract?.orientationManifest === undefined
      ? undefined
      : parseOrientationRoleManifest(value.resumeContract.orientationManifest);
    if (value.resumeContract?.orientationManifest !== undefined && !orientationManifest) {
      return undefined;
    }
    const taskObjective = value.taskObjective === undefined
      ? undefined
      : parseTaskObjectiveContract(value.taskObjective);
    if (value.taskObjective !== undefined && !taskObjective) return undefined;
    return {
      ...value,
      ...(value.resumeContract && orientationManifest
        ? { resumeContract: { ...value.resumeContract, orientationManifest } }
        : {}),
      ...(taskObjective ? { taskObjective } : {}),
    };
  } catch {
    return undefined;
  }
}

function parseOrientationRoleManifest(value: unknown): AiOrientationRoleManifest | undefined {
  if (!value || typeof value !== ""object"") return undefined;
  const candidate = value as Partial<AiOrientationRoleManifest>;
  if (
    typeof candidate.projectRevision !== ""string""
    || candidate.projectRevision.trim().length === 0
    || candidate.projectRevision.length > 500
    || (candidate.rootPath !== null && typeof candidate.rootPath !== ""string"")
    || !candidate.paths
    || typeof candidate.paths !== ""object""
  ) return undefined;
  const source = candidate.paths as Partial<AiOrientationRoleManifest[""paths""]>;
  const roles = [""purpose"", ""components"", ""primaryFlow"", ""uncertainty""] as const;
  const paths = {} as AiOrientationRoleManifest[""paths""];
  const allPaths: string[] = [];
  for (const role of roles) {
    const values = source[role];
    if (
      !Array.isArray(values)
      || values.length > 2
      || values.some((path) =>
        typeof path !== ""string""
        || path.trim().length === 0
        || path.length > 500
        || path.startsWith(""/"")
        || /^[A-Za-z]:[\\/]/.test(path)
        || path.split(/[\\/]+/u).includes("".."")
      )
    ) return undefined;
    paths[role] = [...new Set(values.map((path) => path.trim().replace(/\\/g, ""/"")))];
    allPaths.push(...paths[role]);
  }
  if (new Set(allPaths).size > 8) return undefined;
  return {
    projectRevision: candidate.projectRevision.trim(),
    rootPath: candidate.rootPath === null ? null : candidate.rootPath,
    paths,
  };
}

function parseCapabilityProbeContract(value: unknown): AiCapabilityProbeContract | undefined {
  if (!value || typeof value !== ""object"") return undefined;
  const candidate = value as Partial<AiCapabilityProbeContract>;
  if (
    !Array.isArray(candidate.sourceFiles)
    || candidate.sourceFiles.length === 0
    || candidate.sourceFiles.length > 8
    || candidate.sourceFiles.some((file) => typeof file !== ""string"" || file.trim().length === 0 || file.length > 500)
    || !Array.isArray(candidate.requiredClaims)
    || candidate.requiredClaims.length === 0
    || candidate.requiredClaims.length > 8
    || candidate.requiredClaims.some((claim) => typeof claim !== ""string"" || claim.trim().length === 0 || claim.length > 20)
    || typeof candidate.outputContract !== ""string""
    || candidate.outputContract.length === 0
    || candidate.outputContract.length > 80
  ) return undefined;
  return {
    sourceFiles: candidate.sourceFiles.map((file) => file.trim()),
    requiredClaims: candidate.requiredClaims.map((claim) => claim.trim()),
    outputContract: candidate.outputContract,
  };
}

function parseCapabilityProbeCheckpoint(value: unknown): AiCapabilityProbeCheckpoint | undefined {
  const contract = parseCapabilityProbeContract(value);
  if (!contract || !value || typeof value !== ""object"") return undefined;
  const candidate = value as Partial<AiCapabilityProbeCheckpoint>;
  const parseProgress = (progress: unknown): AiCapabilityProbeProgress | undefined => {
    if (!progress || typeof progress !== ""object"") return undefined;
    const source = progress as Partial<AiCapabilityProbeProgress>;
    const parseList = (items: unknown, maxLength: number): string[] | undefined => {
      if (!Array.isArray(items) || items.length > maxLength) return undefined;
      const values = items
        .filter((item): item is string => typeof item === ""string"" && item.trim().length > 0)
        .map((item) => item.trim().slice(0, 120));
      return values.length === items.length ? [...new Set(values)] : undefined;
    };
    const closedClaims = parseList(source.closedClaims, 8);
    const pendingClaims = parseList(source.pendingClaims, 8);
    const completedGroups = parseList(source.completedGroups, 16);
    const failedGroups = parseList(source.failedGroups, 16);
    if (!closedClaims || !pendingClaims || !completedGroups || !failedGroups) return undefined;
    return { closedClaims, pendingClaims, completedGroups, failedGroups };
  };
  const progress = candidate.progress === undefined
    ? undefined
    : parseProgress(candidate.progress);
  if (
    (candidate.status !== undefined && ![""PENDING"", ""COMPLETE"", ""INCOMPLETE""].includes(candidate.status))
    || (candidate.missingClaims !== undefined && (
      !Array.isArray(candidate.missingClaims)
      || candidate.missingClaims.some((claim) => typeof claim !== ""string"")
    ))
    || (candidate.progress !== undefined && !progress)
    || (candidate.recoveryAttempted !== undefined && typeof candidate.recoveryAttempted !== ""boolean"")
    || (candidate.recoveryAttempt !== undefined && (
      !Number.isInteger(candidate.recoveryAttempt) || candidate.recoveryAttempt < 0 || candidate.recoveryAttempt > 32
    ))
    || (candidate.recoveryFailureKind !== undefined && (
      typeof candidate.recoveryFailureKind !== ""string"" || candidate.recoveryFailureKind.length > 80
    ))
  ) return undefined;
  return {
    ...contract,
    ...(candidate.status ? { status: candidate.status } : {}),
    ...(candidate.missingClaims ? {
      missingClaims: candidate.missingClaims
        .filter((claim): claim is string => typeof claim === ""string"")
        .slice(0, 8)
        .map((claim) => claim.slice(0, 20)),
    } : {}),
    ...(progress ? { progress } : {}),
    ...(candidate.recoveryAttempted !== undefined ? { recoveryAttempted: candidate.recoveryAttempted } : {}),
    ...(candidate.recoveryAttempt !== undefined ? { recoveryAttempt: candidate.recoveryAttempt } : {}),
    ...(candidate.recoveryFailureKind ? { recoveryFailureKind: candidate.recoveryFailureKind.slice(0, 80) } : {}),
  };
}

export function parseAiExecutionCheckpoint(raw: string): AiExecutionCheckpoint | undefined {
  try {
    const value = JSON.parse(raw) as Partial<AiExecutionCheckpoint>;
    if (
      !value ||
      typeof value.stage !== ""string"" ||
      !AI_EXECUTION_CHECKPOINT_STAGES.has(value.stage as AiExecutionCheckpoint[""stage""]) ||
      typeof value.sequence !== ""number"" ||
      !Number.isFinite(value.sequence) ||
      typeof value.updatedAt !== ""string""
    ) {
      return undefined;
    }
    const nodeStates = Array.isArray(value.nodeStates)
      ? value.nodeStates
        .slice(0, AI_EXECUTION_NODE_LIMIT)
        .flatMap((node) => {
          if (!node || typeof node !== ""object"") return [];
          const candidate = node as Partial<AiExecutionNodeCheckpoint>;
          if (
            typeof candidate.id !== ""string"" ||
            typeof candidate.title !== ""string"" ||
            ![""queued"", ""running"", ""passed"", ""failed"", ""blocked""].includes(candidate.status ?? """") ||
            !Array.isArray(candidate.allowedFiles) ||
            !Array.isArray(candidate.dependencies) ||
            typeof candidate.validationProfile !== ""string"" ||
            typeof candidate.attempts !== ""number"" ||
            !Number.isInteger(candidate.attempts) ||
            candidate.attempts < 0 ||
            candidate.attempts > 3 ||
            (candidate.validationAttempts !== undefined && (
              typeof candidate.validationAttempts !== ""number""
              || !Number.isInteger(candidate.validationAttempts)
              || candidate.validationAttempts < 0
              || candidate.validationAttempts > 3
            ))
            || (candidate.lastFailure !== undefined && (
              !candidate.lastFailure
              || typeof candidate.lastFailure !== ""object""
              || ![""failed"", ""blocked""].includes((candidate.lastFailure as { status?: unknown }).status as string)
              || typeof (candidate.lastFailure as { attempt?: unknown }).attempt !== ""number""
              || !Number.isInteger((candidate.lastFailure as { attempt: number }).attempt)
              || (candidate.lastFailure as { attempt: number }).attempt < 1
              || (candidate.lastFailure as { attempt: number }).attempt > 3
              || typeof (candidate.lastFailure as { validationAttempts?: unknown }).validationAttempts !== ""number""
              || !Number.isInteger((candidate.lastFailure as { validationAttempts: number }).validationAttempts)
              || (candidate.lastFailure as { validationAttempts: number }).validationAttempts < 0
              || (candidate.lastFailure as { validationAttempts: number }).validationAttempts > 3
              || typeof (candidate.lastFailure as { detail?: unknown }).detail !== ""string""
            ))
          ) return [];
          return [{
            id: candidate.id.slice(0, 160),
            title: candidate.title.slice(0, 240),
            status: candidate.status as AiExecutionNodeCheckpoint[""status""],
            allowedFiles: candidate.allowedFiles
              .filter((file): file is string => typeof file === ""string"")
              .slice(0, AI_EXECUTION_NODE_FILES_LIMIT)
              .map((file) => file.slice(0, 500)),
            dependencies: candidate.dependencies
              .filter((dependency): dependency is string => typeof dependency === ""string"")
              .slice(0, 12)
              .map((dependency) => dependency.slice(0, 160)),
            validationProfile: candidate.validationProfile as AiExecutionNodeCheckpoint[""validationProfile""],
            attempts: candidate.attempts,
            validationAttempts: candidate.validationAttempts ?? 0,
            ...(Array.isArray(candidate.evidenceRefs) ? { evidenceRefs: candidate.evidenceRefs
              .filter((ref): ref is string => typeof ref === ""string"")
              .slice(0, 8)
              .map((ref) => ref.slice(0, 500)) } : {}),
            ...(candidate.lastFailure
              ? {
                  lastFailure: {
                    status: (candidate.lastFailure as { status: ""failed"" | ""blocked"" }).status,
                    attempt: (candidate.lastFailure as { attempt: number }).attempt,
                    validationAttempts: (candidate.lastFailure as { validationAttempts: number }).validationAttempts,
                    detail: (candidate.lastFailure as { detail: string }).detail.slice(0, 4_000),
                  },
                }
              : {}),
          }];
        })
      : undefined;
    const operation = value.operation && typeof value.operation === ""object""
      ? parseAutonomousOperation(value.operation)
      : undefined;
    if (value.operation !== undefined && !operation) return undefined;
    const recipeBinding = value.recipeBinding === undefined
      ? operation?.binding
      : parseRecipeOperationBinding(value.recipeBinding);
    if (value.recipeBinding !== undefined && !recipeBinding) return undefined;
    if (recipeBinding && operation?.binding
      && JSON.stringify(recipeBinding) !== JSON.stringify(operation.binding)) return undefined;
    const capabilityProbe = value.capabilityProbe === undefined
      ? undefined
      : parseCapabilityProbeCheckpoint(value.capabilityProbe);
    if (value.capabilityProbe !== undefined && !capabilityProbe) return undefined;
    const evidenceProgress = value.evidenceProgress === undefined
      ? undefined
      : parseEvidenceProgressCheckpoint(value.evidenceProgress);
    if (value.evidenceProgress !== undefined && !evidenceProgress) return undefined;
    const orientationManifest = value.orientationManifest === undefined
      ? undefined
      : parseOrientationRoleManifest(value.orientationManifest);
    if (value.orientationManifest !== undefined && !orientationManifest) return undefined;
    const providerAttempts = Array.isArray(value.providerAttempts)
      ? value.providerAttempts
          .filter((attempt) => Boolean(attempt) && typeof attempt === ""object"")
          .map((attempt) => attempt as { provider?: unknown; code?: unknown })
          .filter((attempt): attempt is { provider: string; code: string } =>
            typeof attempt.provider === ""string"" && typeof attempt.code === ""string"",
          )
          .slice(-8)
          .map((attempt) => ({
            provider: attempt.provider.slice(0, 40),
            code: attempt.code.slice(0, 80),
          }))
      : undefined;
    const validatorReceipts = value.validatorReceipts === undefined
      ? undefined
      : Array.isArray(value.validatorReceipts)
        ? value.validatorReceipts.flatMap((receipt) => {
            const parsed = parseTaskObjectiveValidatorReceipt(receipt);
            return parsed ? [parsed] : [];
          })
        : undefined;
    if (
      value.validatorReceipts !== undefined
      && (!validatorReceipts || validatorReceipts.length !== value.validatorReceipts.length)
    ) return undefined;
    return {
      stage: value.stage as AiExecutionCheckpoint[""stage""],
      sequence: value.sequence,
      ...(typeof value.streamedPreview === ""string""
        ? { streamedPreview: value.streamedPreview.slice(-AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT) }
        : {}),
      ...(Array.isArray(value.recentSteps)
        ? { recentSteps: value.recentSteps.slice(-AI_EXECUTION_TRACE_LIMIT) as Array<Record<string, unknown>> }
        : {}),
      ...(nodeStates && nodeStates.length > 0 ? { nodeStates } : {}),
      ...(typeof value.currentNode === ""string"" ? { currentNode: value.currentNode.slice(0, 160) } : {}),
      ...(Array.isArray(value.completedNodes)
        ? {
            completedNodes: value.completedNodes
              .filter((nodeId): nodeId is string => typeof nodeId === ""string"")
              .slice(0, AI_EXECUTION_NODE_LIMIT)
              .map((nodeId) => nodeId.slice(0, 160)),
          }
        : {}),
      ...(typeof value.evidenceVerdict === ""string"" &&
        [""PROVEN"", ""PARTIAL"", ""UNAVAILABLE"", ""BLOCKED"", ""CLAIM_UNCLOSED"", ""NOT_RECORDED""].includes(value.evidenceVerdict)
        ? { evidenceVerdict: value.evidenceVerdict as FlightDeckEvidenceVerdict }
        : {}),
      ...(typeof value.evidenceReason === ""string""
        ? { evidenceReason: value.evidenceReason.slice(0, 500) }
        : {}),
      ...(evidenceProgress ? { evidenceProgress } : {}),
      ...(orientationManifest ? { orientationManifest } : {}),
      ...(typeof value.proofRequired === ""boolean"" ? { proofRequired: value.proofRequired } : {}),
      ...(capabilityProbe ? { capabilityProbe } : {}),
      ...(providerAttempts && providerAttempts.length > 0 ? { providerAttempts } : {}),
      ...(typeof value.detail === ""string"" ? { detail: value.detail.slice(0, 500) } : {}),
      ...(operation ? { operation } : {}),
      ...(recipeBinding ? { recipeBinding } : {}),
      ...(validatorReceipts ? { validatorReceipts } : {}),
      updatedAt: value.updatedAt,
    };
  } catch {
    return undefined;
  }
}

function parseEvidenceProgressCheckpoint(value: unknown): AiEvidenceProgressCheckpoint | undefined {
  if (!value || typeof value !== ""object"") return undefined;
  const candidate = value as Partial<AiEvidenceProgressCheckpoint>;
  const validStatuses = new Set<AiEvidencePathStatus>([
    ""missing"",
    ""complete"",
    ""targeted"",
    ""truncated"",
    ""failed"",
  ]);
  if (
    typeof candidate.operationId !== ""string""
    || typeof candidate.sourceRevision !== ""string""
    || !Array.isArray(candidate.requiredPaths)
    || !Array.isArray(candidate.pathStatuses)
    || !Array.isArray(candidate.completedPaths)
    || !Array.isArray(candidate.missingPaths)
    || (candidate.nextRequiredPath !== undefined && typeof candidate.nextRequiredPath !== ""string"")
  ) return undefined;
  const requiredPaths = candidate.requiredPaths
    .filter((path): path is string => typeof path === ""string"")
    .slice(0, 64)
    .map((path) => path.slice(0, 500));
  const pathStatuses = candidate.pathStatuses
    .slice(0, 64)
    .flatMap((entry) => {
      if (!entry || typeof entry !== ""object"") return [];
      const item = entry as { path?: unknown; status?: unknown };
      if (
        typeof item.path !== ""string""
        || typeof item.status !== ""string""
        || !validStatuses.has(item.status as AiEvidencePathStatus)
      ) return [];
      return [{ path: item.path.slice(0, 500), status: item.status as AiEvidencePathStatus }];
    });
  const toPaths = (paths: unknown[]) => paths
    .filter((path): path is string => typeof path === ""string"")
    .slice(0, 64)
    .map((path) => path.slice(0, 500));
  return {
    operationId: candidate.operationId.slice(0, 160),
    sourceRevision: candidate.sourceRevision.slice(0, 500),
    requiredPaths,
    pathStatuses,
    completedPaths: toPaths(candidate.completedPaths),
    missingPaths: toPaths(candidate.missingPaths),
    ...(candidate.nextRequiredPath !== undefined
      ? { nextRequiredPath: candidate.nextRequiredPath.slice(0, 500) }
      : {}),
  };
}

function parseAutonomousOperation(value: unknown): AutonomousOperationContract | undefined {
  if (!value || typeof value !== ""object"") return undefined;
  const candidate = value as Partial<AutonomousOperationContract>;
  if (
    typeof candidate.operationId !== ""string""
    || typeof candidate.objective !== ""string""
    || typeof candidate.revisionManifest !== ""string""
    || typeof candidate.planHash !== ""string""
    || typeof candidate.policyRevision !== ""string""
    || (candidate.candidateIdentity !== null && typeof candidate.candidateIdentity !== ""string"")
    || !AUTONOMOUS_OPERATION_STATES.includes(candidate.state as AutonomousOperationState)
    || !Array.isArray(candidate.nodes)
    || !Number.isInteger(candidate.retryBudget)
    || !Number.isInteger(candidate.repairAttempts)
    || !Array.isArray(candidate.evidenceRefs)
    || typeof candidate.updatedAt !== ""string""
  ) return undefined;
  const nodes = candidate.nodes.slice(0, AI_EXECUTION_NODE_LIMIT).flatMap((node) => {
    if (!node || typeof node !== ""object"") return [];
    const item = node as Partial<AutonomousOperationNode>;
    if (
      typeof item.id !== ""string"" || ![""inspect"", ""mutate"", ""validate"", ""diagnose"", ""repair"", ""promote"", ""delivery""].includes(item.kind ?? """")
      || ![""queued"", ""running"", ""passed"", ""failed"", ""blocked""].includes(item.status ?? """")
      || !Array.isArray(item.dependencies) || !Array.isArray(item.allowedFiles)
      || !Array.isArray(item.evidenceRefs) || typeof item.validationProfile !== ""string""
      || !Number.isInteger(item.attempts) || !Number.isInteger(item.validationAttempts)
    ) return [];
    const attempts = item.attempts as number;
    const validationAttempts = item.validationAttempts as number;
    return [{
      id: item.id.slice(0, 160),
      kind: item.kind as AutonomousOperationNodeKind,
      dependencies: item.dependencies.filter((v): v is string => typeof v === ""string"").slice(0, 12),
      status: item.status as AutonomousOperationNode[""status""],
      attempts: Math.max(0, Math.min(attempts, 3)),
      validationAttempts: Math.max(0, Math.min(validationAttempts, 3)),
      allowedFiles: item.allowedFiles.filter((v): v is string => typeof v === ""string"").slice(0, AI_EXECUTION_NODE_FILES_LIMIT),
      validationProfile: item.validationProfile.slice(0, 120),
      evidenceRefs: item.evidenceRefs.filter((v): v is string => typeof v === ""string"").slice(0, 8),
    }];
  });
  const acceptanceChecks = (candidate.acceptanceChecks ?? []).slice(0, 12).flatMap((check) => {
    if (!check || typeof check !== ""object"") return [];
    const item = check as Partial<AutonomousAcceptanceCheck>;
    if (
      typeof item.id !== ""string""
      || ![""scope"", ""behavior"", ""validation"", ""evidence""].includes(item.kind ?? """")
      || typeof item.description !== ""string""
      || typeof item.required !== ""boolean""
    ) return [];
    return [{
      id: item.id.slice(0, 120),
      kind: item.kind as AutonomousAcceptanceCheck[""kind""],
      description: item.description.slice(0, 500),
      required: item.required,
    }];
  });
  const retryBudget = candidate.retryBudget as number;
  const repairAttempts = candidate.repairAttempts as number;
  if (nodes.length !== candidate.nodes.length
    || (candidate.acceptanceChecks && acceptanceChecks.length !== candidate.acceptanceChecks.length)
    || retryBudget < 0 || repairAttempts < 0
    || repairAttempts > retryBudget) return undefined;
  const binding = candidate.binding === undefined ? undefined : parseRecipeOperationBinding(candidate.binding);
  if (candidate.binding !== undefined && !binding) return undefined;
  if (binding && binding.operationId !== candidate.operationId) return undefined;
  const taskObjective = candidate.taskObjective === undefined
    ? undefined
    : parseTaskObjectiveContract(candidate.taskObjective);
  if (candidate.taskObjective !== undefined && !taskObjective) return undefined;
  return {
    operationId: candidate.operationId.slice(0, 160),
    ...(taskObjective ? { taskObjective } : {}),
    objective: candidate.objective.slice(0, 2_000),
    revisionManifest: candidate.revisionManifest.slice(0, 2_000),
    planHash: candidate.planHash.slice(0, 160),
    policyRevision: candidate.policyRevision.slice(0, 160),
    candidateIdentity: candidate.candidateIdentity ? candidate.candidateIdentity.slice(0, 500) : null,
    targetPaths: (candidate.targetPaths ?? []).filter((v): v is string => typeof v === ""string"").slice(0, 48),
    expectedBehavior: typeof candidate.expectedBehavior === ""string"" ? candidate.expectedBehavior.slice(0, 2_000) : """",
    acceptanceChecks,
    state: candidate.state as AutonomousOperationState,
    nodes,
    retryBudget: Math.min(retryBudget, 8),
    repairAttempts: Math.min(repairAttempts, 8),
    evidenceRefs: candidate.evidenceRefs.filter((v): v is string => typeof v === ""string"").slice(0, 48),
    ...(binding ? { binding } : {}),
    updatedAt: candidate.updatedAt,
  };
}

function operationStateForCheckpoint(stage: AiExecutionCheckpoint[""stage""]): AutonomousOperationState | undefined {
  if (stage === ""model_call"") return ""inspecting"";
  if (stage === ""tool_loop"") return ""mutating"";
  if (stage === ""finalizing"") return ""validating"";
  if (stage === ""failed"") return ""failed"";
  if (stage === ""cancelled"" || stage === ""client_disconnected"") return ""cancelled"";
  return undefined;
}

function advanceOperationForCheckpoint(
  operation: AutonomousOperationContract,
  stage: AiExecutionCheckpoint[""stage""],
): AutonomousOperationContract {
  const target = operationStateForCheckpoint(stage);
  if (!target || operation.state === target) return operation;
  // A stage-only writer may resume directly at tool_loop after a process
  // restart. The server fills only the known prerequisite transition; it
  // never accepts a provider's assertion as a skipped graph edge.
  const bridge: Partial<Record<AutonomousOperationState, AutonomousOperationState>> = {
    planned: ""inspecting"",
    inspecting: ""mutating"",
    mutating: ""validating"",
  };
  let current = operation;
  while (current.state !== target) {
    const next = bridge[current.state];
    if (!next) {
      if (target === ""failed"" || target === ""cancelled"") {
        return transitionAutonomousOperation(current, target);
      }
      return current;
    }
    current = transitionAutonomousOperation(current, next);
  }
  return current;
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

/**
 * Reconcile checkpointed node progress with the server-owned plan that will be
 * resumed. The checkpoint may advance status and attempts, but it must never
 * redefine a node's title, scope, dependency graph, or validation profile.
 * Returning undefined is an intentional fail-closed signal for stale/mixed
 * execution state.
 */
export function reconcileExecutionNodeCheckpoint(
  planNodes: readonly ExecutionNode[],
  checkpointNodes: AiExecutionCheckpoint[""nodeStates""] | undefined,
): ExecutionNode[] | undefined {
  if (!checkpointNodes || checkpointNodes.length === 0) return [...planNodes];
  if (planNodes.length !== checkpointNodes.length) return undefined;

  const checkpointById = new Map(checkpointNodes.map((node) => [node.id, node]));
  if (checkpointById.size !== planNodes.length) return undefined;

  for (const planNode of planNodes) {
    const checkpointNode = checkpointById.get(planNode.id);
    if (
      !checkpointNode
      || !sameStringArray(planNode.allowedFiles, checkpointNode.allowedFiles)
      || !sameStringArray(planNode.dependencies, checkpointNode.dependencies)
      || planNode.validationProfile !== checkpointNode.validationProfile
      || checkpointNode.attempts < planNode.attempts
      || checkpointNode.validationAttempts < planNode.validationAttempts
      || (planNode.lastFailure
        && (
          planNode.lastFailure.status !== checkpointNode.lastFailure?.status
          || planNode.lastFailure.attempt > (checkpointNode.lastFailure?.attempt ?? 0)
        ))
      || (planNode.status === ""passed"" && checkpointNode.status !== ""passed"")
      || (planNode.status === ""blocked"" && checkpointNode.status !== ""blocked"")
      || (checkpointNode.status === ""running"" && checkpointNode.attempts < 1)
    ) {
      return undefined;
    }
  }

  return planNodes.map((planNode) => {
    const checkpointNode = checkpointById.get(planNode.id)!;
    return {
      ...planNode,
      status: checkpointNode.status,
      attempts: checkpointNode.attempts,
      validationAttempts: checkpointNode.validationAttempts,
      ...(checkpointNode.lastFailure ? { lastFailure: checkpointNode.lastFailure } : {}),
    };
  });
}

/**
 * Turns the last durable checkpoint into server-owned continuation context.
 * The provider still needs a fresh call after a process crash, but it receives
 * the bounded checkpoint and can continue from the last observed stage instead
 * of blindly replaying the original user request.
 */
export function buildAiExecutionResumeContext(
  checkpoint: AiExecutionCheckpoint | undefined,
): string {
  if (!checkpoint || checkpoint.stage === ""queued"") return """";
  return [
    ""SERVER-OWNED DURABLE RESUME CONTEXT"",
    ""The previous worker stopped unexpectedly. Continue the same execution from the checkpoint below."",
    ""Do not claim that any step succeeded unless the current tool result or persisted evidence confirms it."",
    ""Do not repeat a completed deferred write or apply action; writes remain approval-gated."",
    formatUntrustedContent(JSON.stringify(checkpoint), {
      source: ""checkpoint"",
      revision: checkpoint.updatedAt,
    }),
  ].join(""\n"");
}

export async function createAiExecution(params: {
  userId: string;
  request: AiExecutionRequestEnvelope;
  idempotencyKey: string;
  correlationId?: string;
  attempt?: number;
  projectId: string;
  sessionId?: string;
  linkedTaskId?: string;
  buildPlanMessageId?: string;
  recipeBinding?: RecipeOperationBinding;
  /** Server-owned managed project root used by this execution. */
  workspaceRoot?: string | null;
}): Promise<{ execution: AiExecution; resumeToken?: string; created: boolean }> {
  if (params.recipeBinding) {
    assertRecipeOperationBinding(params.recipeBinding, {
      projectId: params.projectId,
      operationId: params.request.operationId,
      sourceRevision: params.request.workspaceRevision,
    });
  }
  const existing = await db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.userId, params.userId),
      eq(aiExecutionsTable.idempotencyKey, params.idempotencyKey),
    ))
    .limit(1);
  if (existing[0]) {
    const row = existing[0];
    const storedRequest = parseExecutionRequest(row.request);
    if (
      !storedRequest
      || storedRequest.projectId !== params.projectId
      || storedRequest.sessionId !== params.sessionId
      || (
        params.workspaceRoot !== undefined
        && (row.workspaceRoot ?? null) !== (params.workspaceRoot ?? null)
      )
      || (
        params.request.workspaceRevision !== undefined
        && (row.baseRevision ?? storedRequest.workspaceRevision ?? null)
          !== (params.request.workspaceRevision ?? null)
      )
    ) {
      throw new Error(""Execution idempotency key is bound to a different request"");
    }
    return { execution: row, created: false };
  }

  const resumeToken = createResumeToken();
  const now = new Date();
  const executionId = randomUUID();
  const operationId = params.request.operationId ?? params.buildPlanMessageId ?? executionId;
  const operation = createAutonomousOperationContract({
    operationId,
    taskObjective: params.request.taskObjective,
    objective: typeof params.request.objective === ""string""
      ? params.request.objective
      : params.request.message,
    revisionManifest: params.request.workspaceRevision,
    targetPaths: params.request.validationTargetPaths,
    expectedBehavior: params.request.message,
    ...(params.recipeBinding ? { binding: params.recipeBinding } : {}),
  });
  const [execution] = await db
    .insert(aiExecutionsTable)
    .values({
      id: executionId,
      projectId: params.projectId,
      sessionId: params.sessionId ?? null,
      operationId,
      linkedTaskId: params.linkedTaskId ?? null,
      buildPlanMessageId: params.buildPlanMessageId ?? null,
      userId: params.userId,
      idempotencyKey: params.idempotencyKey,
      correlationId: params.correlationId ?? null,
      attempt: params.attempt ?? 0,
      resumeTokenHash: hashResumeToken(resumeToken),
      request: JSON.stringify(params.request),
      checkpoint: JSON.stringify({
        stage: ""queued"",
        sequence: 0,
        operation,
        ...(params.request.capabilityProbe
          ? {
              capabilityProbe: {
                ...params.request.capabilityProbe,
                status: ""PENDING"" as const,
                recoveryAttempted: false,
              },
            }
          : {}),
        ...(params.recipeBinding ? { recipeBinding: params.recipeBinding } : {}),
        updatedAt: now.toISOString(),
      } satisfies AiExecutionCheckpoint),
      baseRevision: params.request.workspaceRevision ?? null,
      workspaceRoot: params.workspaceRoot ?? params.request.workspaceRoot ?? null,
      status: ""queued"",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing({
      target: [aiExecutionsTable.userId, aiExecutionsTable.idempotencyKey],
    })
    .returning();

  if (execution) return { execution, resumeToken, created: true };

  // Another identical request won the unique-key race. Re-read the row rather
  // than surfacing the expected conflict, so both callers get the same
  // resumable execution identity. Keep the request binding check here as well:
  // a conflicting key must never allow a different request to reuse it.
  const [racedExecution] = await db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.userId, params.userId),
      eq(aiExecutionsTable.idempotencyKey, params.idempotencyKey),
    ))
    .limit(1);
  if (!racedExecution) throw new Error(""Failed to create AI execution"");
  const racedRequest = parseExecutionRequest(racedExecution.request);
  if (
    !racedRequest
    || racedRequest.projectId !== params.projectId
    || racedRequest.sessionId !== params.sessionId
    || (
      params.workspaceRoot !== undefined
      && (racedExecution.workspaceRoot ?? null) !== (params.workspaceRoot ?? null)
    )
    || (
      params.request.workspaceRevision !== undefined
      && (racedExecution.baseRevision ?? racedRequest.workspaceRevision ?? null)
        !== (params.request.workspaceRevision ?? null)
    )
  ) {
    throw new Error(""Execution idempotency key is bound to a different request"");
  }
  return { execution: racedExecution, created: false };
}

export async function getAiExecutionForUser(
  executionId: string,
  userId: string,
): Promise<AiExecution | undefined> {
  const [execution] = await db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, executionId),
      eq(aiExecutionsTable.userId, userId),
    ))
    .limit(1);
  return execution;
}

export type RecipeNodeAuthorizationPhase = ""start"" | ""completion"" | ""retry"";

export async function authorizeRecipeNodeExecution(params: {
  executionId: string;
  userId: string;
  workerId: string;
  binding: RecipeOperationBinding;
  phase: RecipeNodeAuthorizationPhase;
}): Promise<{ allowed: boolean; reason?: string }> {
  const execution = await getAiExecutionForUser(params.executionId, params.userId);
  if (!execution) return { allowed: false, reason: ""durable execution row is missing"" };
  if (execution.status === ""cancelled"" || execution.cancelRequestedAt) {
    return { allowed: false, reason: ""durable execution is cancelled"" };
  }
  if (execution.status !== ""running"") {
    return { allowed: false, reason: `durable execution status is ${execution.status}` };
  }
  if (execution.workerId !== params.workerId) {
    return { allowed: false, reason: ""recipe lease owner changed"" };
  }
  if (!execution.leaseUntil || execution.leaseUntil <= new Date()) {
    return { allowed: false, reason: ""recipe lease expired"" };
  }
  const checkpoint = parseAiExecutionCheckpoint(execution.checkpoint);
  const storedBinding = checkpoint?.recipeBinding;
  if (!storedBinding) return { allowed: false, reason: ""durable recipe binding is missing"" };
  if (storedBinding.sourceRevision !== params.binding.sourceRevision) {
    return { allowed: false, reason: ""recipe source revision drifted"" };
  }
  if (storedBinding.candidateIdentity !== params.binding.candidateIdentity) {
    return { allowed: false, reason: ""recipe candidate identity changed"" };
  }
  if (storedBinding.candidateWorkspace !== params.binding.candidateWorkspace) {
    return { allowed: false, reason: ""recipe candidate workspace changed"" };
  }
  if (storedBinding.leaseOwner !== params.workerId) {
    return { allowed: false, reason: ""durable recipe binding lease owner changed"" };
  }
  try {
    assertRecipeOperationBinding(params.binding, {
      projectId: execution.projectId,
      operationId: execution.operationId ?? undefined,
      sourceRevision: parseExecutionRequest(execution.request)?.workspaceRevision,
      candidateIdentity: storedBinding.candidateIdentity,
      candidateWorkspace: storedBinding.candidateWorkspace,
      leaseOwner: params.workerId,
      requireLease: true,
      now: new Date(),
    });
  } catch {
    return { allowed: false, reason: `recipe binding rejected before ${params.phase}` };
  }
  return { allowed: true };
}

export async function recoverAiExecutionResumeToken(params: {
  executionId: string;
  userId: string;
  linkedTaskId?: string;
  expectedAttempt?: number;
}): Promise<{ execution: AiExecution; resumeToken: string } | undefined> {
  const resumeToken = createResumeToken();
  const [candidate] = await db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.userId, params.userId),
      inArray(aiExecutionsTable.status, [""paused"", ""failed""]),
      ...(params.linkedTaskId ? [eq(aiExecutionsTable.linkedTaskId, params.linkedTaskId)] : []),
      ...(params.expectedAttempt !== undefined
        ? [eq(aiExecutionsTable.attempt, params.expectedAttempt)]
        : []),
    ))
    .limit(1);
  if (!candidate) return undefined;
  const checkpoint = parseAiExecutionCheckpoint(candidate.checkpoint);
  const [priorAcceptance] = await db
    .select({
      reasonCode: aiExecutionAcceptancesTable.reasonCode,
      resumable: aiExecutionAcceptancesTable.resumable,
      nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
    })
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.executionId, candidate.id),
      eq(aiExecutionAcceptancesTable.attempt, candidate.attempt),
    ))
    .limit(1);
  const request = parseExecutionRequest(candidate.request);
  const ordinaryChat = request?.turnIntent === ""CHAT"" && request.proofRequired !== true;
  const parserFailureRecovery =
    ordinaryChat
    && priorAcceptance?.reasonCode === ""MODEL_OUTPUT_INVALID""
    && priorAcceptance.nextActionCode === ""RESUME_ALLOWED""
    && priorAcceptance.resumable === 1;
  const transientProviderRecovery =
    ordinaryChat
    && priorAcceptance?.reasonCode === ""EXECUTION_PROVIDER_FAILURE""
    && (priorAcceptance.nextActionCode === ""RETRY_AFTER_TIMEOUT""
      || priorAcceptance.nextActionCode === ""RETRY_AFTER_RATE_LIMIT"")
    && priorAcceptance.resumable === 0;
  // Ordinary chat has no durable resume contract. This guard also protects
  // legacy paused rows created before reconciliation learned that distinction.
  if (
    (ordinaryChat && !parserFailureRecovery && !transientProviderRecovery)
    || (priorAcceptance && priorAcceptance.resumable !== 1)
  ) {
    return undefined;
  }
  if (
    candidate.status === ""failed"" &&
    (checkpoint?.evidenceVerdict === ""CLAIM_UNCLOSED""
      || priorAcceptance?.resumable !== 1
      || priorAcceptance?.nextActionCode === ""START_NEW_PROBE"")
  ) {
    return undefined;
  }
  const [execution] = await db
    .update(aiExecutionsTable)
    .set({
      resumeTokenHash: hashResumeToken(resumeToken),
      updatedAt: new Date(),
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.userId, params.userId),
      inArray(aiExecutionsTable.status, [""paused"", ""failed""]),
      ...(params.linkedTaskId ? [eq(aiExecutionsTable.linkedTaskId, params.linkedTaskId)] : []),
      ...(params.expectedAttempt !== undefined
        ? [eq(aiExecutionsTable.attempt, params.expectedAttempt)]
        : []),
    ))
    .returning();
  return execution ? { execution, resumeToken } : undefined;
}

/**
 * Retry a failed proof-backed conversational execution without creating a
 * second user turn. The retry action is accepted only from the current
 * server-owned acceptance row and the same immutable request contract.
 */
export async function recoverAiExecutionRetryToken(params: {
  executionId: string;
  userId: string;
  expectedAttempt?: number;
}): Promise<{ execution: AiExecution; resumeToken: string } | undefined> {
  const resumeToken = createResumeToken();
  const [candidate] = await db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.userId, params.userId),
      inArray(aiExecutionsTable.status, [""paused"", ""failed""]),
      ...(params.expectedAttempt !== undefined
        ? [eq(aiExecutionsTable.attempt, params.expectedAttempt)]
        : []),
    ))
    .limit(1);
  if (!candidate) return undefined;

  const request = parseExecutionRequest(candidate.request);
  const ordinaryChat = request?.turnIntent === ""CHAT"" && request.proofRequired !== true;
  if (!hasAiExecutionResumeContract(request) && !ordinaryChat) return undefined;

  const [priorAcceptance] = await db
    .select({
      reasonCode: aiExecutionAcceptancesTable.reasonCode,
      resumable: aiExecutionAcceptancesTable.resumable,
      nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
      disposition: aiExecutionAcceptancesTable.disposition,
    })
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.executionId, candidate.id),
      eq(aiExecutionAcceptancesTable.attempt, candidate.attempt),
    ))
    .limit(1);
  if (
    !priorAcceptance
    || (ordinaryChat
      && priorAcceptance.reasonCode !== ""EXECUTION_PROVIDER_FAILURE"")
    || (priorAcceptance.nextActionCode !== ""RETRY_AFTER_TIMEOUT""
      && priorAcceptance.nextActionCode !== ""RETRY_AFTER_RATE_LIMIT"")
    || priorAcceptance.resumable !== 0
  ) {
    return undefined;
  }

  const disposition = priorAcceptance.disposition;
  const recoveryState = disposition && typeof disposition === ""object""
    ? (disposition as { recoveryState?: unknown }).recoveryState
    : undefined;
  const retryAt = disposition && typeof disposition === ""object""
    ? (disposition as { retryAt?: unknown }).retryAt
    : undefined;
  if (recoveryState !== ""REQUIRED"") return undefined;
  if (typeof retryAt === ""string"" && Date.parse(retryAt) > Date.now()) return undefined;

  const [execution] = await db
    .update(aiExecutionsTable)
    .set({
      resumeTokenHash: hashResumeToken(resumeToken),
      updatedAt: new Date(),
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.userId, params.userId),
      inArray(aiExecutionsTable.status, [""paused"", ""failed""]),
      eq(aiExecutionsTable.attempt, candidate.attempt),
      ...(params.expectedAttempt !== undefined
        ? [eq(aiExecutionsTable.attempt, params.expectedAttempt)]
        : []),
    ))
    .returning();
  return execution ? { execution, resumeToken } : undefined;
}

export type AiExecutionRecoveryAction = ""resume"" | ""abandon"";
export type AiExecutionRecoveryOutcome =
  | ""resume_accepted""
  | ""abandoned""
  | ""already_abandoned""
  | ""already_running""
  | ""stale""
  | ""not_eligible"";

export type AiExecutionRecoveryResult = {
  execution: AiExecution;
  outcome: AiExecutionRecoveryOutcome;
  resumeToken?: string;
};

function recoveryCheckpoint(execution: AiExecution): AiExecutionCheckpoint | undefined {
  return parseAiExecutionCheckpoint(execution.checkpoint);
}

function mergeTerminalCheckpoint(
  execution: AiExecution,
  params: {
    cancelled: boolean;
    error: string;
    nodeStates?: AiExecutionCheckpoint[""nodeStates""];
    recentSteps?: Array<Record<string, unknown>>;
    streamedPreview?: string;
    operation?: AutonomousOperationContract;
    acceptanceDisposition?: AiAcceptanceDisposition;
    evidenceVerdict?: FlightDeckEvidenceVerdict;
    evidenceReason?: string;
    evidenceProgress?: AiExecutionCheckpoint[""evidenceProgress""];
    capabilityProbe?: AiCapabilityProbeCheckpoint;
    providerAttempts?: AiProviderAttemptCheckpoint[];
    retryAfterMs?: number;
    retryAt?: string;
  },
): AiExecutionCheckpoint {
  const previous = parseAiExecutionCheckpoint(execution.checkpoint);
  const request = parseExecutionRequest(execution.request);
  const now = new Date().toISOString();
  const sequence = Math.max(
    execution.checkpointVersion,
    typeof previous?.sequence === ""number"" ? previous.sequence : 0,
  ) + 1;
  const operation = params.operation
    ?? previous?.operation;
  const previousBinding = previous?.recipeBinding ?? operation?.binding;
  const terminalBinding = previousBinding
    ? {
        ...previousBinding,
        phase: params.cancelled ? ""cancelled"" as const : ""failed"" as const,
        leaseOwner: null,
        leaseUntil: null,
      }
    : undefined;
  return {
    ...(previous ?? {}),
    stage: params.cancelled ? ""cancelled"" : ""failed"",
    sequence,
    ...(operation
      ? {
          operation: params.cancelled
            ? { ...operation, state: ""cancelled"", ...(terminalBinding ? { binding: terminalBinding } : {}), updatedAt: now }
            : {
                ...operation,
                state: ""failed"",
                ...(terminalBinding ? { binding: terminalBinding } : {}),
                updatedAt: now,
              },
        }
      : {}),
    ...(terminalBinding ? { recipeBinding: terminalBinding } : {}),
    ...(params.streamedPreview
      ? { streamedPreview: params.streamedPreview.slice(-AI_EXECUTION_CHECKPOINT_PREVIEW_LIMIT) }
      : {}),
    ...(params.recentSteps && params.recentSteps.length > 0
      ? { recentSteps: params.recentSteps.slice(-AI_EXECUTION_TRACE_LIMIT) }
      : {}),
    ...(params.nodeStates && params.nodeStates.length > 0
      ? { nodeStates: params.nodeStates }
      : {}),
    ...(params.acceptanceDisposition
      ? { acceptanceDisposition: params.acceptanceDisposition }
      : {}),
    ...(params.evidenceVerdict
      ? { evidenceVerdict: params.evidenceVerdict }
      : {}),
    ...(params.evidenceReason
      ? { evidenceReason: params.evidenceReason.slice(0, 500) }
      : {}),
    ...(params.evidenceProgress
      ? { evidenceProgress: params.evidenceProgress }
      : {}),
    ...(params.capabilityProbe
      ? { capabilityProbe: params.capabilityProbe }
      : previous?.capabilityProbe
        ? {
            capabilityProbe: {
              ...previous.capabilityProbe,
              status: ""INCOMPLETE"" as const,
            },
          }
        : request?.capabilityProbe
          ? {
              capabilityProbe: {
                ...request.capabilityProbe,
                status: ""INCOMPLETE"" as const,
                recoveryAttempted: false,
              },
            }
          : {}),
    ...(params.providerAttempts && params.providerAttempts.length > 0
      ? {
          providerAttempts: params.providerAttempts
            .slice(-8)
            .map((attempt) => ({
              provider: attempt.provider.slice(0, 40),
              code: attempt.code.slice(0, 80),
            })),
        }
      : {}),
    ...(params.retryAfterMs !== undefined
      ? { retryAfterMs: Math.max(0, Math.round(params.retryAfterMs)) }
      : {}),
    ...(params.retryAt ? { retryAt: params.retryAt } : {}),
    detail: params.error.slice(0, 500),
    updatedAt: now,
  } satisfies AiExecutionCheckpoint;
}

/**
 * Operator recovery is deliberately narrower than the legacy capability
 * endpoint. Only a paused execution whose server-owned operation is uncertain
 * can be resumed or abandoned. The checkpoint and operation identity are
 * retained for both outcomes; no new execution or user turn is created.
 */
export async function requestAiExecutionRecovery(params: {
  executionId: string;
  userId: string;
  action: AiExecutionRecoveryAction;
  revision?: string;
}): Promise<AiExecutionRecoveryResult | undefined> {
  const current = await getAiExecutionForUser(params.executionId, params.userId);
  if (!current) return undefined;
  const checkpoint = recoveryCheckpoint(current);
  const operation = checkpoint?.operation;
  const storedRevision = operation?.revisionManifest ?? null;
  if (params.revision && params.revision !== storedRevision) {
    return { execution: current, outcome: ""stale"" };
  }
  const priorRecovery = checkpoint && typeof checkpoint === ""object""
    ? (checkpoint as AiExecutionCheckpoint & { recovery?: { action?: string } }).recovery
    : undefined;
  if (priorRecovery?.action === ""abandon"" || current.status === ""cancelled"") {
    return { execution: current, outcome: ""already_abandoned"" };
  }
  if (params.action === ""resume"" && priorRecovery?.action === ""resume"") {
    return { execution: current, outcome: ""resume_accepted"" };
  }
  if (params.action === ""resume"" && current.status === ""running"") {
    return { execution: current, outcome: ""already_running"" };
  }
  const [priorAcceptance] = await db
    .select({
      resumable: aiExecutionAcceptancesTable.resumable,
      nextActionCode: aiExecutionAcceptancesTable.nextActionCode,
    })
    .from(aiExecutionAcceptancesTable)
    .where(and(
      eq(aiExecutionAcceptancesTable.executionId, current.id),
      eq(aiExecutionAcceptancesTable.attempt, current.attempt),
    ))
    .limit(1);
  if (
    params.action === ""resume""
    && priorAcceptance
    && (priorAcceptance.resumable !== 1 || priorAcceptance.nextActionCode === ""START_NEW_PROBE"")
  ) {
    return { execution: current, outcome: ""not_eligible"" };
  }
  if (current.status !== ""paused"" || operation?.state !== ""uncertain"") {
    return { execution: current, outcome: ""not_eligible"" };
  }

  if (params.action === ""resume"") {
    const resumeToken = createResumeToken();
    const nextCheckpoint = {
      ...checkpoint,
      recovery: { action: ""resume"", outcome: ""resume_accepted"", updatedAt: new Date().toISOString() },
    };
    const [updated] = await db.update(aiExecutionsTable).set({
      resumeTokenHash: hashResumeToken(resumeToken),
      attempt: sql`${aiExecutionsTable.attempt} + 1`,
      checkpoint: JSON.stringify(nextCheckpoint),
      updatedAt: new Date(),
    }).where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.userId, params.userId),
      eq(aiExecutionsTable.status, ""paused""),
    )).returning();
    return updated
      ? { execution: updated, outcome: ""resume_accepted"", resumeToken }
      : { execution: current, outcome: ""not_eligible"" };
  }

  const now = new Date();
  const nextCheckpoint = {
    ...checkpoint,
    stage: ""cancelled"" as const,
    sequence: Date.now(),
    recovery: { action: ""abandon"", outcome: ""abandoned"", updatedAt: now.toISOString() },
    updatedAt: now.toISOString(),
  };
  const finalized = await finalizeExecutionAcceptance({
    executionId: params.executionId,
    finalizationKey: `execution:${params.executionId}:attempt:${current.attempt}:abandoned`,
    outcome: ""INTERRUPTED"",
    terminalStatus: ""cancelled"",
    reasonCode: ""EXECUTION_ABANDONED"",
    recoveryState: ""INCOMPLETE"",
    resumable: false,
    error: ""Execution abandoned by the operator."",
    checkpoint: JSON.stringify(nextCheckpoint),
  });
  const updated = finalized.accepted
    ? await getAiExecutionForUser(params.executionId, params.userId)
    : undefined;
  return updated
    ? { execution: updated, outcome: ""abandoned"" }
    : { execution: current, outcome: ""not_eligible"" };
}

export async function claimAiExecution(params: {
  executionId: string;
  userId: string;
  workerId: string;
  resumeToken?: string;
  recipeBinding?: RecipeOperationBinding;
}): Promise<AiExecution | undefined> {
  const tokenHash = params.resumeToken ? hashResumeToken(params.resumeToken) : undefined;
  const existing = params.recipeBinding
    ? await getAiExecutionForUser(params.executionId, params.userId)
    : undefined;
  if (params.recipeBinding) {
    if (!existing) return undefined;
    const storedBinding = parseAiExecutionCheckpoint(existing.checkpoint)?.recipeBinding;
    if (!storedBinding || JSON.stringify(storedBinding) !== JSON.stringify(params.recipeBinding)) return undefined;
    try {
      assertRecipeOperationBinding(params.recipeBinding, {
        projectId: existing.projectId,
        operationId: existing.operationId ?? undefined,
        sourceRevision: parseExecutionRequest(existing.request)?.workspaceRevision,
      });
    } catch {
      return undefined;
    }
  }
  const claimTime = new Date();
  const claimLeaseUntil = new Date(claimTime.getTime() + AI_EXECUTION_LEASE_MS);
  const claimCheckpoint = existing && params.recipeBinding ? parseAiExecutionCheckpoint(existing.checkpoint) : undefined;
  const claimedBinding = params.recipeBinding
    ? { ...params.recipeBinding, phase: ""running"" as const, leaseOwner: params.workerId, leaseUntil: claimLeaseUntil.toISOString() }
    : undefined;
  const [claimed] = await db
    .update(aiExecutionsTable)
    .set({
      status: ""running"",
      workerId: params.workerId,
      leaseUntil: claimLeaseUntil,
      lastHeartbeatAt: claimTime,
      startedAt: claimTime,
      updatedAt: claimTime,
      error: null,
      cancelRequestedAt: null,
      ...(claimedBinding && claimCheckpoint ? {
        checkpoint: JSON.stringify({
          ...claimCheckpoint,
          recipeBinding: claimedBinding,
          ...(claimCheckpoint.operation ? { operation: { ...claimCheckpoint.operation, binding: claimedBinding } } : {}),
          sequence: claimCheckpoint.sequence + 1,
          updatedAt: claimTime.toISOString(),
        } satisfies AiExecutionCheckpoint),
        checkpointVersion: sql`${aiExecutionsTable.checkpointVersion} + 1`,
      } : {}),
      ...(tokenHash
        ? {
            // A resume is a new auditable attempt. The previous attempt's
            // assistant row remains linked from its acceptance record, but it
            // must not block the new attempt from reserving its own terminal
            // message.
            attempt: sql`${aiExecutionsTable.attempt} + 1`,
            finalMessageId: null,
            completedAt: null,
          }
        : {}),
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.userId, params.userId),
      ...(params.recipeBinding ? [
        eq(aiExecutionsTable.projectId, params.recipeBinding.projectId),
        eq(aiExecutionsTable.operationId, params.recipeBinding.operationId),
      ] : []),
      inArray(aiExecutionsTable.status, [""queued"", ""paused"", ""failed""]),
      ...(tokenHash ? [eq(aiExecutionsTable.resumeTokenHash, tokenHash)] : []),
    ))
    .returning();
  return claimed;
}

export async function checkpointAiExecution(params: {
  executionId: string;
  workerId: string;
  checkpoint: AiExecutionCheckpoint;
  recipeBinding?: RecipeOperationBinding;
}): Promise<boolean> {
  // Keep this update atomic: the worker lease and checkpoint version are the
  // concurrency boundary. Callers that advance an operation include its
  // server-validated contract in the checkpoint; legacy stage-only writers
  // remain compatible and do not get a second read/race window here.
  const durableOperation = params.checkpoint.operation
    ? advanceOperationForCheckpoint(params.checkpoint.operation, params.checkpoint.stage)
    : undefined;
  const checkpointBinding = params.checkpoint.recipeBinding ?? durableOperation?.binding;
  if (params.recipeBinding) {
    if (!checkpointBinding) return false;
    try {
      assertRecipeOperationBinding(checkpointBinding, {
        projectId: params.recipeBinding.projectId,
        operationId: params.recipeBinding.operationId,
        sourceRevision: params.recipeBinding.sourceRevision,
        candidateIdentity: params.recipeBinding.candidateIdentity,
        candidateWorkspace: params.recipeBinding.candidateWorkspace,
        leaseOwner: params.workerId,
        requireLease: true,
      });
    } catch {
      return false;
    }
    if (JSON.stringify(checkpointBinding) !== JSON.stringify(params.recipeBinding)) return false;
  }
  const durableCheckpoint = durableOperation
    ? { ...params.checkpoint, operation: durableOperation, ...(checkpointBinding ? { recipeBinding: checkpointBinding } : {}) }
    : { ...params.checkpoint, ...(checkpointBinding ? { recipeBinding: checkpointBinding } : {}) };
  const [updated] = await db
    .update(aiExecutionsTable)
    .set({
      checkpoint: JSON.stringify(durableCheckpoint),
      checkpointVersion: durableCheckpoint.sequence,
      updatedAt: new Date(),
      lastHeartbeatAt: new Date(),
      leaseUntil: new Date(Date.now() + AI_EXECUTION_LEASE_MS),
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.workerId, params.workerId),
      eq(aiExecutionsTable.status, ""running""),
      gt(aiExecutionsTable.leaseUntil, new Date()),
      // A stale worker must not overwrite a newer durable checkpoint.
      lt(aiExecutionsTable.checkpointVersion, params.checkpoint.sequence),
    ))
    .returning({ id: aiExecutionsTable.id });
  return Boolean(updated);
}

/**
 * Enriches the immutable resume contract with the server-owned orientation
 * role manifest once the query planner has selected it. The worker lease keeps
 * this write bound to the active execution; a retry cannot replace it with a
 * different root or revision.
 */
export async function persistAiExecutionOrientationManifest(params: {
  executionId: string;
  workerId: string;
  manifest: AiOrientationRoleManifest;
}): Promise<boolean> {
  const [row] = await db
    .select({
      request: aiExecutionsTable.request,
      projectId: aiExecutionsTable.projectId,
    })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.workerId, params.workerId),
      eq(aiExecutionsTable.status, ""running""),
      gt(aiExecutionsTable.leaseUntil, new Date()),
    ))
    .limit(1);
  const request = row ? parseExecutionRequest(row.request) : undefined;
  if (
    !request
    || request.projectOrientation !== true
    || request.workspaceRevision !== params.manifest.projectRevision
    || (request.workspaceRoot ?? null) !== params.manifest.rootPath
    || !request.resumeContract
  ) return false;
  if (!hasCompleteProjectOrientationSources(params.manifest.paths)) return false;
  const existing = request.resumeContract.orientationManifest;
  if (existing) return JSON.stringify(existing) === JSON.stringify(params.manifest);
  const nextRequest: AiExecutionRequestEnvelope = {
    ...request,
    resumeContract: {
      ...request.resumeContract,
      orientationManifest: params.manifest,
    },
  };
  const [updated] = await db
    .update(aiExecutionsTable)
    .set({
      request: JSON.stringify(nextRequest),
      updatedAt: new Date(),
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.workerId, params.workerId),
      eq(aiExecutionsTable.status, ""running""),
      gt(aiExecutionsTable.leaseUntil, new Date()),
    ))
    .returning({ id: aiExecutionsTable.id });
  return Boolean(updated);
}

export async function heartbeatAiExecution(params: {
  executionId: string;
  workerId: string;
}): Promise<boolean> {
  const [updated] = await db
    .update(aiExecutionsTable)
    .set({
      lastHeartbeatAt: new Date(),
      leaseUntil: new Date(Date.now() + AI_EXECUTION_LEASE_MS),
      updatedAt: new Date(),
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.workerId, params.workerId),
      eq(aiExecutionsTable.status, ""running""),
      gt(aiExecutionsTable.leaseUntil, new Date()),
    ))
    .returning({ id: aiExecutionsTable.id });
  return Boolean(updated);
}

export async function ownsAiExecutionLease(params: {
  executionId: string;
  workerId: string;
}): Promise<boolean> {
  const [execution] = await db
    .select({
      status: aiExecutionsTable.status,
      workerId: aiExecutionsTable.workerId,
      leaseUntil: aiExecutionsTable.leaseUntil,
      cancelRequestedAt: aiExecutionsTable.cancelRequestedAt,
    })
    .from(aiExecutionsTable)
    .where(eq(aiExecutionsTable.id, params.executionId))
    .limit(1);
  return Boolean(
    execution
    && execution.status === ""running""
    && execution.workerId === params.workerId
    && execution.leaseUntil
    && execution.leaseUntil > new Date()
    && !execution.cancelRequestedAt,
  );
}

export async function completeAiExecution(params: {
  executionId: string;
  workerId: string;
  /**
   * Chat executions link acceptance to their persisted assistant message.
   * Autonomous workflow executions have no chat row and therefore complete
   * with a null message identity.
   */
  finalMessageId?: string | null;
  finalMessageContent?: string;
  proposalId?: string;
  operation?: AutonomousOperationContract;
  taskObjective?: TaskObjectiveContract;
  validatorReceipts?: readonly TaskObjectiveValidatorReceipt[];
  objectiveValidated?: boolean;
  taskResult?: unknown;
  nodeStates?: AiExecutionCheckpoint[""nodeStates""];
  evidenceVerdict?: FlightDeckEvidenceVerdict;
  evidenceReason?: string;
  evidenceProgress?: AiExecutionCheckpoint[""evidenceProgress""];
  capabilityProbe?: AiCapabilityProbeCheckpoint;
  proofRequired?: boolean;
  evidenceRefs?: readonly string[];
  evidence?: readonly Pick<
    ValidationEvidence,
    ""evidenceId""
    | ""artifactRef""
    | ""operationId""
    | ""projectRevision""
    | ""candidateHash""
  >[];
  analysisEvidence?: AnalysisEvidenceCompletion;
  /**
   * A forensic/capability execution must be accepted by the server-owned
   * forensic terminal gate before the durable autonomous completion path can
   * finalize it.  Complete source reads are retained separately and are not
   * sufficient proof.
   */
  forensicAccepted?: boolean;
  operationId?: string;
  workspaceRoot?: string | null;
  candidateIdentity?: string | null;
  recipeBinding?: RecipeOperationBinding;
  recipeReceipt?: RecipeReceipt;
  evidenceReads?: readonly EvidenceReadInput[];
  /** Orientation requires complete role coverage in addition to source reads. */
  orientationCoverageComplete?: boolean;
}): Promise<boolean> {
  const [current] = await db
    .select({
      projectId: aiExecutionsTable.projectId,
      operationId: aiExecutionsTable.operationId,
      workspaceRoot: aiExecutionsTable.workspaceRoot,
      baseRevision: aiExecutionsTable.baseRevision,
      attempt: aiExecutionsTable.attempt,
      request: aiExecutionsTable.request,
      checkpoint: aiExecutionsTable.checkpoint,
      checkpointVersion: aiExecutionsTable.checkpointVersion,
      leaseUntil: aiExecutionsTable.leaseUntil,
    })
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.workerId, params.workerId),
      eq(aiExecutionsTable.status, ""running""),
    ))
    .limit(1);
  const request = current ? parseExecutionRequest(current.request) : undefined;
  const checkpoint = current ? parseAiExecutionCheckpoint(current.checkpoint) : undefined;
  const hasPersistedWorkspaceRoot =
    current?.workspaceRoot !== null
    || request?.workspaceRoot !== undefined;
  const effectiveWorkspaceRoot = hasPersistedWorkspaceRoot
    ? params.workspaceRoot ?? current?.workspaceRoot ?? request?.workspaceRoot ?? null
    : null;
  const nextSequence = current
    ? Math.max(
        current.checkpointVersion,
        typeof checkpoint?.sequence === ""number"" ? checkpoint.sequence : 0,
      ) + 1
    : 1;
  if (params.recipeBinding) {
    if (!current?.leaseUntil || current.leaseUntil <= new Date()) return false;
    try {
      assertRecipeOperationBinding(params.recipeBinding, {
        projectId: current.projectId,
        operationId: current.operationId ?? undefined,
        sourceRevision: request?.workspaceRevision,
        leaseOwner: params.workerId,
        requireLease: true,
      });
    } catch {
      return false;
    }
    if (!checkpoint?.recipeBinding || checkpoint.recipeBinding.leaseOwner !== params.workerId) return false;
  }
  const requiresProof = params.proofRequired ?? request?.proofRequired ?? false;
  const pendingProposal = Boolean(params.proposalId);
  const forensicExecution = request?.turnIntent === ""FORENSIC_AUDIT""
    || Boolean(request?.capabilityProbe && request?.proofRequired === true);
  const projectOrientationExecution =
    request?.turnIntent === ""PROJECT_QUERY"" && request?.projectOrientation === true;
  // Project orientation is a source-evidence contract even when it is not a
  // proof-required targeted query. Generic complete reads must not turn an
  // explanation with a missing role into a PROVEN terminal result.
  const projectOrientationAcceptance = projectOrientationExecution;
  const projectQueryProofExecution =
    request?.turnIntent === ""PROJECT_QUERY""
    && requiresProof
    && !forensicExecution
    && !projectOrientationExecution;
  const operation = params.operation ?? checkpoint?.operation;
  const taskObjective = params.taskObjective ?? request?.taskObjective ?? operation?.taskObjective;
  const inferredEvidenceRefs = [
    ...(params.evidenceRefs ?? []),
    ...(params.evidenceReads ?? [])
      .filter((read) => read.complete && !read.truncated)
      .map((read) => `source-read:${read.path}`),
  ];
  const effectiveEvidenceVerdict =
    params.evidenceVerdict && params.evidenceVerdict !== ""NOT_RECORDED""
      ? params.evidenceVerdict
      : !forensicExecution && params.evidenceReads?.some((read) => read.complete && !read.truncated)
        ? ""PROVEN"" as const
        : params.evidenceVerdict;
  if (requiresProof) {
    if (taskObjective && !pendingProposal) {
      const objectiveCheck = validateTaskObjectiveContract({
        contract: taskObjective,
        workspaceRevision: request?.workspaceRevision ?? """",
        projectId: current?.projectId,
        objectiveValidated: params.objectiveValidated === true,
        evidenceVerdict: effectiveEvidenceVerdict,
        evidenceComplete: effectiveEvidenceVerdict === ""PROVEN"",
        targetPaths: operation?.targetPaths ?? request?.validationTargetPaths ?? [],
        operationId: params.operationId ?? current.operationId ?? params.executionId,
        validatorReceipts: params.validatorReceipts,
        taskResult: params.taskResult,
      });
      if (!objectiveCheck.allowed) return false;
    }
    if (forensicExecution && params.forensicAccepted !== true) return false;
    if (!operation) return false;
    if (!request?.workspaceRevision) return false;
    if (
      params.workspaceRoot !== undefined
      && hasPersistedWorkspaceRoot
      && current.workspaceRoot !== params.workspaceRoot
    ) return false;
    const durableOperationId = current.operationId ?? params.executionId;
    // A proof-required project query has a semantic acceptance contract:
    // complete source reads alone do not prove that the requested claims were
    // answered. Never fall back to the generic operation gate when the
    // project-query analysis evidence was not produced.
    if (projectQueryProofExecution && !params.analysisEvidence) return false;
    const completion = params.analysisEvidence
      ? validateAnalysisEvidenceCompletion(params.analysisEvidence, {
          operationId: params.operationId ?? durableOperationId,
          sourceRevision: request.workspaceRevision,
        })
      : (() => {
          return validateAutonomousOperationCompletion(operation, {
            // A complete retained source read is server-owned acceptance
            // evidence even when the provider did not produce a separate
            // validation artifact. Give the operation a deterministic
            // reference so read-only forensic turns can satisfy the same
            // proof gate without trusting provider prose alone.
              evidenceRefs: inferredEvidenceRefs,
            evidence: params.evidence,
              evidenceVerdict: effectiveEvidenceVerdict,
            validatorReceipts: params.validatorReceipts,
            workspaceRevision: request.workspaceRevision,
            candidateIdentity: params.candidateIdentity,
            operationId: params.operationId ?? durableOperationId,
            checkpointOperationId: checkpoint?.operation?.operationId ?? """",
            nodeStates: params.nodeStates?.map((node) => ({
              status: node.status,
              evidenceRefs: node.evidenceRefs ?? [],
            })),
            // A pending approval proposal is intentionally review-ready rather than
            // autonomously proven. It still has to satisfy identity, scope, node, and
            // evidence-reference checks before the chat execution is finalized.
            requireProven: !pendingProposal,
          });
        })();
    if (!completion.allowed) return false;
  }
  if (projectOrientationAcceptance && params.orientationCoverageComplete !== true) {
    return false;
  }
  const sourceEvidenceRequired = projectOrientationAcceptance
    || forensicExecution
    || Boolean(params.analysisEvidence)
    || Boolean(params.evidenceReads && params.evidenceReads.length > 0);
  const now = new Date();
  const checkpointEnvelope = {
    stage: ""completed"" as const,
    sequence: nextSequence,
    ...(params.operation ? { operation: params.operation } : {}),
    ...(params.nodeStates && params.nodeStates.length > 0
      ? {
          nodeStates: params.nodeStates,
          completedNodes: params.nodeStates
            .filter((node) => node.status === ""passed"")
            .map((node) => node.id)
            .slice(0, AI_EXECUTION_NODE_LIMIT),
        }
      : {}),
    ...(effectiveEvidenceVerdict ? { evidenceVerdict: effectiveEvidenceVerdict } : {}),
    ...(inferredEvidenceRefs.length > 0
      ? { evidenceRefs: [...new Set(inferredEvidenceRefs)].slice(0, 48) }
      : {}),
    ...(params.evidenceReason ? { evidenceReason: params.evidenceReason.slice(0, 500) } : {}),
    ...(params.evidenceProgress ? { evidenceProgress: params.evidenceProgress } : {}),
    ...(params.validatorReceipts && params.validatorReceipts.length > 0
      ? { validatorReceipts: params.validatorReceipts }
      : {}),
    ...(typeof params.proofRequired === ""boolean"" ? { proofRequired: params.proofRequired } : {}),
    ...(params.capabilityProbe ? { capabilityProbe: params.capabilityProbe } : {}),
    updatedAt: now.toISOString(),
  } satisfies AiExecutionCheckpoint;
  const result = await finalizeExecutionAcceptance({
    executionId: params.executionId,
    workerId: params.workerId,
    finalMessageId: params.finalMessageId,
    finalMessageContent: params.finalMessageContent,
    finalizationKey: `execution:${params.executionId}:attempt:${current?.attempt ?? 0}:completed`,
    outcome: ""SUCCEEDED"",
    terminalStatus: ""completed"",
    reasonCode: ""ACCEPTED"",
    recoveryState: ""NONE"",
    ...(requiresProof || sourceEvidenceRequired
      ? {
          evidence: {
            operationId: params.operationId,
            workspaceRoot: pendingProposal ? null : effectiveWorkspaceRoot,
            sourceRevision: request?.workspaceRevision,
            candidateIdentity: params.candidateIdentity,
              verdict: effectiveEvidenceVerdict,
            required: true,
            sourceEvidenceRequired,
            reads: params.evidenceReads,
          } satisfies EvidenceSnapshotInput,
        }
      : {}),
    resumable: false,
    sourceRevision: request?.workspaceRevision,
    candidateIdentity: params.candidateIdentity,
    proposalId: params.proposalId ?? null,
    recipeReceipt: params.recipeReceipt,
    taskObjective,
    taskObjectiveStatus: params.objectiveValidated ? ""PROVEN"" : ""INCOMPLETE"",
    checkpoint: JSON.stringify(checkpointEnvelope),
  });
  return result.accepted;
}

export async function failAiExecution(params: {
  executionId: string;
  workerId: string;
  error: string;
  cancelled?: boolean;
  /** Server-owned terminal recovery state from the same run classifier. */
  recoveryState?: ""NONE"" | ""REQUIRED"" | ""INCOMPLETE"";
  /** Whether this terminal failure still has a valid same-execution resume path. */
  resumable?: boolean;
  nodeStates?: AiExecutionCheckpoint[""nodeStates""];
  recentSteps?: Array<Record<string, unknown>>;
  streamedPreview?: string;
  operation?: AutonomousOperationContract;
  recipeBinding?: RecipeOperationBinding;
  acceptanceDisposition?: AiAcceptanceDisposition;
  evidenceVerdict?: FlightDeckEvidenceVerdict;
  evidenceReason?: string;
  evidenceProgress?: AiExecutionCheckpoint[""evidenceProgress""];
  providerAttempts?: AiProviderAttemptCheckpoint[];
  retryAfterMs?: number;
  retryAt?: string;
  disposition?: Record<string, unknown>;
  finalMessageId?: string;
  finalMessageErrorCode?: string;
  workspaceRoot?: string | null;
  evidenceReads?: readonly EvidenceReadInput[];
  orientationCoverageComplete?: boolean;
}): Promise<boolean> {
  const [current] = await db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.workerId, params.workerId),
      gt(aiExecutionsTable.leaseUntil, new Date()),
      inArray(
        aiExecutionsTable.status,
        params.cancelled ? [""running"", ""cancelling""] : [""running""],
      ),
    ))
    .limit(1);
  const retryAt = params.retryAt
    ?? (params.retryAfterMs !== undefined
      ? new Date(Date.now() + Math.max(0, params.retryAfterMs)).toISOString()
      : undefined);
  const terminalCheckpoint = current
    ? mergeTerminalCheckpoint(current, { ...params, cancelled: params.cancelled ?? false, retryAt })
    : undefined;
  if (params.recipeBinding && current) {
    const request = parseExecutionRequest(current.request);
    const checkpoint = parseAiExecutionCheckpoint(current.checkpoint);
    try {
      assertRecipeOperationBinding(params.recipeBinding, {
        projectId: current.projectId,
        operationId: current.operationId ?? undefined,
        sourceRevision: request?.workspaceRevision,
        leaseOwner: params.workerId,
        requireLease: true,
      });
    } catch {
      return false;
    }
    if (!checkpoint?.recipeBinding || checkpoint.recipeBinding.leaseOwner !== params.workerId) return false;
  }
  if (!current || !terminalCheckpoint) return false;
  const request = parseExecutionRequest(current.request);
  const hasPersistedWorkspaceRoot =
    current.workspaceRoot !== null
    || request?.workspaceRoot !== undefined;
  const ordinaryChat = request?.turnIntent === ""CHAT"" && request.proofRequired !== true;
  const projectOrientationExecution =
    request?.turnIntent === ""PROJECT_QUERY"" && request?.projectOrientation === true;
  const providerFailure = params.providerAttempts !== undefined;
  const parserFailure = params.finalMessageErrorCode === ""MODEL_OUTPUT_INVALID"";
  const reasonCode = params.cancelled
    ? ""EXECUTION_CANCELLED""
    : parserFailure
      ? ""MODEL_OUTPUT_INVALID""
    : params.acceptanceDisposition
      ? ""EXECUTION_ACCEPTANCE_INCOMPLETE""
      : providerFailure
        ? ""EXECUTION_PROVIDER_FAILURE""
        : ""EXECUTION_FAILED"";
  const finalized = await finalizeExecutionAcceptance({
    executionId: params.executionId,
    workerId: params.workerId,
    finalMessageId: params.finalMessageId,
    finalMessageErrorCode: params.finalMessageErrorCode,
    finalizationKey: `execution:${params.executionId}:attempt:${current.attempt}:${reasonCode}`,
    outcome: params.cancelled ? ""INTERRUPTED"" : ""FAILED"",
    terminalStatus: params.cancelled ? ""cancelled"" : ""failed"",
    reasonCode,
    failureKind: params.acceptanceDisposition?.failureKind
      ?? (params.cancelled ? ""CANCELLATION"" : providerFailure ? ""PROVIDER_FAILURE"" : ""EXECUTION_FAILURE""),
    recoveryState: params.cancelled
      ? ""INCOMPLETE""
      : ordinaryChat && !parserFailure
        ? ""INCOMPLETE""
        : params.acceptanceDisposition?.recoveryState
          ?? params.recoveryState
          ?? (providerFailure ? ""REQUIRED"" : undefined)
          ?? ""REQUIRED"",
    retryAfterMs: params.retryAfterMs,
    retryAt,
    // Ordinary CHAT turns do not create a resumable execution contract. The
    // parser-failure exception is narrowly server-owned and replays the same
    // request through the bounded recovery coordinator.
    resumable: params.resumable
      ?? (
        !params.cancelled
        && (
          parserFailure
          || (
            !params.acceptanceDisposition
            && params.recoveryState !== ""INCOMPLETE""
            && hasAiExecutionResumeContract(request)
          )
        )
      ),
    disposition: params.disposition ?? params.acceptanceDisposition,
    error: params.error,
    evidence: !ordinaryChat && (params.evidenceVerdict || params.evidenceReads)
      ? {
          operationId: current.operationId,
            workspaceRoot: hasPersistedWorkspaceRoot
              ? params.workspaceRoot ?? current.workspaceRoot ?? request?.workspaceRoot ?? null
              : null,
          sourceRevision: request?.workspaceRevision,
           verdict: params.evidenceVerdict ?? (request?.proofRequired === true ? ""NOT_RECORDED"" : undefined),
           required: request?.proofRequired === true || projectOrientationExecution,
          reads: params.evidenceReads,
        }
      : undefined,
    checkpoint: JSON.stringify(terminalCheckpoint),
  });
  return finalized.accepted;
}

export async function requestAiExecutionCancel(params: {
  executionId: string;
  userId: string;
}): Promise<AiExecution | undefined> {
  const now = new Date();
  const current = await getAiExecutionForUser(params.executionId, params.userId);
  if (!current) return undefined;
  const cancelledCheckpoint = JSON.stringify(mergeTerminalCheckpoint(current, {
    cancelled: true,
    error: ""Execution cancelled before a worker started."",
  }));

  if (current.status === ""queued"" || current.status === ""paused"") {
    const finalized = await finalizeExecutionAcceptance({
      executionId: current.id,
      finalizationKey: `execution:${current.id}:attempt:${current.attempt}:cancelled`,
      outcome: ""INTERRUPTED"",
      terminalStatus: ""cancelled"",
      reasonCode: ""EXECUTION_CANCELLED"",
      recoveryState: ""INCOMPLETE"",
      resumable: false,
      error: ""Execution cancelled before a worker started."",
      checkpoint: cancelledCheckpoint,
    });
    return finalized.accepted
      ? await getAiExecutionForUser(current.id, params.userId)
      : undefined;
  }

  const [updated] = await db
    .update(aiExecutionsTable)
    .set({
      status: ""cancelling"",
      cancelRequestedAt: now,
      updatedAt: now,
    })
    .where(and(
      eq(aiExecutionsTable.id, params.executionId),
      eq(aiExecutionsTable.userId, params.userId),
      eq(aiExecutionsTable.status, ""running""),
    ))
    .returning();
  if (updated) activeControllers.get(updated.id)?.abort(new Error(""AI execution cancellation requested""));
  return updated;
}

export function registerAiExecutionController(executionId: string, controller: AbortController): void {
  activeControllers.set(executionId, controller);
}

export function unregisterAiExecutionController(executionId: string, controller: AbortController): void {
  if (activeControllers.get(executionId) === controller) activeControllers.delete(executionId);
}

export async function reconcileAiExecutions(params: { expiredOnly?: boolean } = {}): Promise<number> {
  const now = new Date();
  const running = await db.select().from(aiExecutionsTable).where(
    params.expiredOnly
      ? or(
          eq(aiExecutionsTable.status, ""cancelling""),
          and(
            eq(aiExecutionsTable.status, ""running""),
            lt(aiExecutionsTable.leaseUntil, now),
          ),
        )
      : inArray(aiExecutionsTable.status, [""running"", ""cancelling""]),
  );
  let count = 0;
  for (const execution of running) {
    const checkpoint = parseAiExecutionCheckpoint(execution.checkpoint);
    if (execution.status === ""cancelling"") {
      const terminalCheckpoint = mergeTerminalCheckpoint(execution, {
        cancelled: true,
        error: ""Execution cancellation was finalized after the server restarted."",
      });
      const finalized = await finalizeExecutionAcceptance({
        executionId: execution.id,
        finalizationKey: `execution:${execution.id}:attempt:${execution.attempt}:reconciled-cancel`,
        outcome: ""INTERRUPTED"",
        terminalStatus: ""cancelled"",
        reasonCode: ""EXECUTION_CANCELLED"",
        recoveryState: ""INCOMPLETE"",
        resumable: false,
        error: ""Execution cancelled by the user."",
        checkpoint: JSON.stringify(terminalCheckpoint),
      });
      if (finalized.accepted && !finalized.duplicate) count += 1;
      continue;
    }
    const operation = checkpoint?.operation;
    const request = parseExecutionRequest(execution.request);
    const ordinaryChat = request?.turnIntent === ""CHAT"" && request.proofRequired !== true;
    const uncertainOperation = operation
      ? { ...operation, state: ""uncertain"" as const, updatedAt: now.toISOString() }
      : undefined;
    const nextCheckpoint = checkpoint
      ? {
          ...checkpoint,
          ...(uncertainOperation ? { operation: uncertainOperation } : {}),
          recovery: {
            action: ""uncertain"",
            phase: operation?.state ?? null,
            outcome: ""recovery_required"",
            updatedAt: now.toISOString(),
          },
          updatedAt: now.toISOString(),
        }
      : undefined;
    const finalized = await finalizeExecutionAcceptance({
      executionId: execution.id,
      finalizationKey: `execution:${execution.id}:attempt:${execution.attempt}:lease-expired`,
      outcome: ""FAILED"",
      terminalStatus: ""paused"",
      reasonCode: ""EXECUTION_LEASE_EXPIRED"",
      recoveryState: ""REQUIRED"",
      // A plain CHAT turn is retriable by starting a new turn, but it is not
      // resumable through the forensic/task recovery contract.
      resumable: !ordinaryChat,
      error: ""Execution interrupted; operator recovery is required."",
      checkpoint: nextCheckpoint ? JSON.stringify(nextCheckpoint) : undefined,
    });
    if (finalized.accepted && !finalized.duplicate) count += 1;
  }
  return count;
}

export async function listRecoverableAiExecutions(userId: string, sessionId: string): Promise<AiExecution[]> {
  return db
    .select()
    .from(aiExecutionsTable)
    .where(and(
      eq(aiExecutionsTable.userId, userId),
      eq(aiExecutionsTable.sessionId, sessionId),
      inArray(aiExecutionsTable.status, [""queued"", ""running"", ""paused"", ""cancelling""]),
    ));
}
```",2026-09-19T21:01:34.550Z
f8c78424-317a-4351-a8af-c5f4c427d4f6,8e78c54c-23e5-445e-85ec-6e3816154184,artifacts/api-server/src/lib/ai-terminal-outcome.ts,source,,,303b731eadc9e8f0cb304c24bebe80cc61556a13048f083e38d635d0bcd7d840,25259,1,0,"File: artifacts/api-server/src/lib/ai-terminal-outcome.ts
```
import type { AgentStep, ProviderId } from ""@workspace/ai-orchestrator"";
import {
  classifyProviderFailure,
  decideProviderFailurePolicy,
  type ProviderFailureCategory,
} from ""./provider-failure-diagnostics.js"";

export type AiTerminalFailureKind =
  | ""QUALITY_REVIEW""
  | ""TOOL_FAILURE""
  | ""CANCELLATION""
  | ""RECOVERY_FAILURE""
  | ""INCOMPLETE"";

export type AiTerminalOutcome = {
  outcome: ""SUCCEEDED"" | ""FAILED"" | ""INTERRUPTED"";
  failureKind?: AiTerminalFailureKind;
  providerFailureCategory?: ProviderFailureCategory;
  contractFailureCategory?: AiExecutionContractFailureCategory;
  retryable: boolean;
  code?: string;
  message?: string;
  recoveryState: ""NONE"" | ""REQUIRED"" | ""INCOMPLETE"";
  /** True only when the existing forensic evidence gates accepted the result. */
  evidenceAccepted: boolean;
  /** Server-owned next required path, when the evidence contract provides one. */
  nextRequiredPath?: string;
};

/**
 * One public identity for a terminal operation across persistence, SSE, and
 * reconnect/history projections. Nullable fields are intentional for legacy
 * terminal rows created before the acceptance/message link was available.
 */
export type AiTerminalProjection = {
  executionId: string;
  sessionId: string;
  attempt: number;
  messageId: string | null;
  acceptanceId: string | null;
  operationId: string | null;
  correlationId: string;
  status: ""completed"" | ""failed"" | ""cancelled"" | ""paused"";
  outcome: ""SUCCEEDED"" | ""FAILED"" | ""INTERRUPTED"";
  reasonCode: string | null;
  nextActionCode: string | null;
  resumable: boolean;
  taskObjective?: {
    kind: string;
    validatorIds: string[];
    status: ""PROVEN"" | ""INCOMPLETE"" | ""UNAVAILABLE"";
  };
};

/**
 * Small, server-owned summary of provider fallback activity. This is the
 * only attempt telemetry shape that may cross an operator-facing execution
 * boundary. It intentionally contains counts and bounded categories only:
 * model output, prompts, paths, credentials, and provider messages never
 * belong here.
 */
export const AI_EXECUTION_DIAGNOSTIC_PROVIDERS = [
  ""groq"",
  ""deepseek"",
  ""openrouter"",
  ""gemini"",
] as const satisfies readonly ProviderId[];
export type AiExecutionDiagnosticProvider = (typeof AI_EXECUTION_DIAGNOSTIC_PROVIDERS)[number];

export const AI_EXECUTION_PROVIDER_FAILURE_CATEGORIES = [
  ""TIMEOUT"",
  ""MODEL_REJECTED"",
  ""MODEL_UNAVAILABLE"",
  ""RATE_LIMITED"",
  ""FALLBACK_EXHAUSTED"",
  ""TRANSPORT_FAILURE"",
  ""MALFORMED_RESPONSE"",
  ""UNKNOWN"",
] as const;
export type AiExecutionProviderFailureCategory =
  (typeof AI_EXECUTION_PROVIDER_FAILURE_CATEGORIES)[number];

export const AI_EXECUTION_CONTRACT_FAILURE_CATEGORIES = [
  ""MALFORMED_RESPONSE"",
  ""MISSING_CLAIMS"",
  ""CITATION_MISMATCH"",
  ""SEMANTIC_FAILURE"",
  ""PROVIDER_EMPTY"",
  ""UNKNOWN"",
] as const;
export type AiExecutionContractFailureCategory =
  (typeof AI_EXECUTION_CONTRACT_FAILURE_CATEGORIES)[number];

export type AiExecutionDiagnostics = {
  schemaVersion: 1;
  attempts: number;
  failedAttempts: number;
  cancelledAttempts: number;
  fallbackAttempts: number;
  providers: Array<{
    provider: AiExecutionDiagnosticProvider;
    attempts: number;
    failedAttempts: number;
    fallbackAttempts: number;
  }>;
  failureCategories: {
    provider: Partial<Record<AiExecutionProviderFailureCategory, number>>;
    contract: Partial<Record<AiExecutionContractFailureCategory, number>>;
  };
};

/**
 * Stable, public acceptance projection.  This deliberately contains no
 * validator prose, evidence identities, provider details, or workspace paths.
 * Keep this contract small because it is copied to the stream, message, and
 * durable execution projections.
 */
export const AI_ACCEPTANCE_REASON_CODES = [
  ""EXECUTION_ACCEPTANCE_INCOMPLETE"",
] as const;
export type AiAcceptanceReasonCode = (typeof AI_ACCEPTANCE_REASON_CODES)[number];
export const AI_ACCEPTANCE_OPERATOR_ACTIONS = [
  ""START_NEW_RUN"",
] as const;
export type AiAcceptanceOperatorAction = (typeof AI_ACCEPTANCE_OPERATOR_ACTIONS)[number];
export type AiAcceptanceDisposition = {
  reasonCodes: AiAcceptanceReasonCode[];
  outcome: ""FAILED"" | ""INTERRUPTED"";
  failureKind: ""INCOMPLETE"";
  recoveryState: ""INCOMPLETE"";
  operatorAction: AiAcceptanceOperatorAction;
  nextActionCode?: ""NONE"" | ""RESUME_ALLOWED"" | ""START_NEW_PROBE"" | ""REVIEW_INCOMPLETE_EVIDENCE"" | ""ABANDON_EXECUTION"" | ""RETRY_AFTER_TIMEOUT"";
};

const GENERIC_ACCEPTANCE_DISPOSITION: AiAcceptanceDisposition = {
  reasonCodes: [""EXECUTION_ACCEPTANCE_INCOMPLETE""],
  outcome: ""FAILED"",
  failureKind: ""INCOMPLETE"",
  recoveryState: ""INCOMPLETE"",
  operatorAction: ""START_NEW_RUN"",
};

/**
 * Accept only the server-owned acceptance shape, or derive the same safe
 * generic fallback for an older proof-required failed execution.
 */
export function publicAcceptanceDisposition(input: {
  value?: unknown;
  code?: unknown;
  outcome?: unknown;
  failureKind?: unknown;
  recoveryState?: unknown;
  status?: unknown;
  proofRequired?: boolean;
  evidenceVerdict?: unknown;
}): AiAcceptanceDisposition | undefined {
  const value = input.value;
  if (value && typeof value === ""object"" && !Array.isArray(value)) {
    const candidate = value as Record<string, unknown>;
    const reasonCodes = candidate.reasonCodes;
    if (
      Array.isArray(reasonCodes)
      && reasonCodes.length > 0
      && reasonCodes.every((code): code is AiAcceptanceReasonCode =>
        AI_ACCEPTANCE_REASON_CODES.includes(code as AiAcceptanceReasonCode),
      )
      && (candidate.outcome === ""FAILED"" || candidate.outcome === ""INTERRUPTED"")
      && candidate.failureKind === ""INCOMPLETE""
      && candidate.recoveryState === ""INCOMPLETE""
      && AI_ACCEPTANCE_OPERATOR_ACTIONS.includes(candidate.operatorAction as AiAcceptanceOperatorAction)
    ) {
      return {
        reasonCodes: [...new Set(reasonCodes)] as AiAcceptanceReasonCode[],
        outcome: candidate.outcome,
        failureKind: ""INCOMPLETE"",
        recoveryState: ""INCOMPLETE"",
        operatorAction: candidate.operatorAction as AiAcceptanceOperatorAction,
      };
    }
  }

  const explicitAcceptance = input.code === ""EXECUTION_ACCEPTANCE_INCOMPLETE"";
  const legacyProofFailure = input.proofRequired === true
    && (input.status === ""failed"" || input.outcome === ""FAILED"")
    && input.evidenceVerdict !== ""PROVEN"";
  if (!explicitAcceptance && !legacyProofFailure) return undefined;
  return { ...GENERIC_ACCEPTANCE_DISPOSITION };
}

type TerminalClassifierInput = {
  result?: unknown;
  trace: readonly AgentStep[];
  cancelled?: boolean;
  leaseLost?: boolean;
  transportInterrupted?: boolean;
  providerError?: {
    code?: unknown;
    providerCode?: unknown;
    providerStatus?: unknown;
    fallbackExhausted?: boolean;
    retryable?: boolean;
  };
  /** A provider returned no usable completion before any required evidence. */
  providerEmptyBeforeEvidence?: boolean;
  endedBeforeEvidence?: boolean;
  requiresEvidence?: boolean;
  /** Route intent, rather than response prose, determines forensic gates. */
  forensic?: boolean;
  /**
   * A server-owned project-query evidence contract already passed its
   * operation/revision/claim/closure checks. Provider recovery failures that
   * remain in the trace are provisional in this case, not terminal blockers.
   */
  analysisEvidenceAccepted?: boolean;
  /** At least one source read was attempted, including failed/truncated reads. */
  evidenceAttempted?: boolean;
  /** At least one complete, server-owned source body is available. */
  completeEvidenceAvailable?: boolean;
  /** At least one source read is incomplete (failed or truncated). */
  incompleteEvidenceAvailable?: boolean;
  /** The server-owned objective still has an unmet required evidence path/claim. */
  requiredEvidencePending?: boolean;
  /** The next server-selected required path, when one is known. */
  nextRequiredPath?: string;
  /**
   * Legacy alias retained for callers that have not yet supplied the full
   * evidence state. New callers should pass the separated fields above.
   */
  retainedEvidenceAvailable?: boolean;
};

function record(step: AgentStep | undefined): Record<string, unknown> {
  if (!step || typeof step !== ""object"") return {};
  const value = step as unknown as Record<string, unknown>;
  const nested = value.trace ?? value.state;
  return nested && typeof nested === ""object""
    ? { ...value, ...(nested as Record<string, unknown>) }
    : value;
}

function latest<T extends AgentStep[""kind""]>(
  trace: readonly AgentStep[],
  kind: T,
): AgentStep | undefined {
  return [...trace].reverse().find((step) => step.kind === kind);
}

function isSafeCode(value: unknown): value is string {
  return typeof value === ""string""
    && /^[A-Z][A-Z0-9_]{2,79}$/.test(value);
}

function safeToolCode(step: AgentStep | undefined): string {
  const category = record(step).analysisFailureCategory;
  if (category === ""timeout"") return ""TOOL_ANALYSIS_TIMEOUT"";
  if (category === ""stale_revision"") return ""TOOL_ANALYSIS_STALE_REVISION"";
  if (category === ""root_unavailable"") return ""TOOL_ANALYSIS_ROOT_UNAVAILABLE"";
  if (category === ""unavailable_dependency"") return ""TOOL_UNAVAILABLE"";
  const code = record(step).diagnosticCode;
  return isSafeCode(code) && code.startsWith(""TOOL_"") ? code : ""TOOL_EXECUTION_FAILED"";
}

function safeToolMessage(step: AgentStep | undefined): string {
  // Tool summaries can contain repository text, paths, or provider diagnostics.
  // The public terminal contract needs a stable explanation, not a copy of
  // untrusted tool output.
  void step;
  return ""The required project analysis tool did not complete."";
}

function responseText(result: unknown): string {
  if (!result || typeof result !== ""object"") return """";
  const response = (result as { response?: unknown }).response;
  return typeof response === ""string"" ? response : """";
}

function hasDiagnostic(
  trace: readonly AgentStep[],
  pattern: RegExp,
  includeDetails = false,
): boolean {
  return trace.some((step) => {
    const value = record(step);
    return pattern.test(String(value.code ?? """"))
      || (includeDetails
        && Array.isArray(value.details)
        && value.details.some((detail) => pattern.test(String(detail))));
  });
}

/**
 * Recovery diagnostics are not all terminal failures: a server-owned
 * deterministic Finding/no-Finding fallback may intentionally replace a
 * rejected provider report.  Only treat the provider/contract recovery as
 * blocking when that authoritative fallback marker is absent.
 */
export function hasForensicRecoveryBlocker(trace: readonly AgentStep[]): boolean {
  const deterministicFallbackAccepted = hasDiagnostic(
    trace,
    /FORENSIC_DETERMINISTIC_(?:NO_FINDING|FINDING)/i,
  );
  if (deterministicFallbackAccepted) return false;
  return hasDiagnostic(
    trace,
    /FORENSIC_(?:CONTRACT_RECOVERY_(?:EXHAUSTED|FAILED|REJECTED|PARSE_FAILED)|STRUCTURED_RECOVERY_REJECTED|EVIDENCE_ONLY_FALLBACK)/i,
  );
}

function hasMalformedStructuredOutput(trace: readonly AgentStep[]): boolean {
  const decision = record(latest(trace, ""decision_trace""));
  if (decision.finalState === ""VERIFIED"") return false;
  return hasDiagnostic(
    trace,
    /FORENSIC_STRUCTURED_RECOVERY_PARSE_FAILED/i,
    true,
  );
}

/**
 * Classify a completed orchestrator turn before it is persisted or projected.
 *
 * Precedence is intentionally strict:
 * cancellation/transport interruption > required tool failure > terminal
 * recovery failure > incomplete evidence > accepted evidence > success.
 * A blocked-looking report can never hide a cancellation or required failure,
 * and NO_FINDING is successful only when the forensic ledger and decision
 * gates have accepted it.
 */
export function classifyAiTerminalOutcome(input: TerminalClassifierInput): AiTerminalOutcome {
  const trace = input.trace;
  const done = latest(trace, ""done"");
  const toolResult = [...trace].reverse().find((step) =>
    step.kind === ""tool_result""
    && [""failed"", ""unavailable"", ""cancelled""].includes(String(record(step).resultKind)),
  );
  const doneRecord = record(done);
  const toolRecord = record(toolResult);
  const cancelled = !input.leaseLost && (Boolean(input.cancelled || input.transportInterrupted)
    || doneRecord.stopReason === ""cancelled""
    || toolRecord.resultKind === ""cancelled""
    || hasDiagnostic(trace, /AbortError|cancel(?:lation|led).*user/i, true));

  if (cancelled) {
    return {
      outcome: ""INTERRUPTED"",
      failureKind: ""CANCELLATION"",
      retryable: true,
      code: ""EXECUTION_CANCELLED"",
      message: ""Execution was cancelled before completion."",
      recoveryState: ""INCOMPLETE"",
      evidenceAccepted: false,
    };
  }

  if (input.leaseLost) {
    return {
      outcome: ""FAILED"",
      failureKind: ""INCOMPLETE"",
      retryable: true,
      code: ""EXECUTION_LEASE_EXPIRED"",
      message: ""Execution ownership expired before completion."",
      recoveryState: ""REQUIRED"",
      evidenceAccepted: false,
    };
  }

  if (doneRecord.stopReason === ""tool_failure"" || toolResult) {
    const toolWasCancelled = toolRecord.resultKind === ""cancelled"";
    return {
      outcome: toolWasCancelled ? ""INTERRUPTED"" : ""FAILED"",
      failureKind: toolWasCancelled ? ""CANCELLATION"" : ""TOOL_FAILURE"",
      retryable: true,
      code: toolWasCancelled ? ""TOOL_CANCELLED"" : safeToolCode(toolResult),
      message: toolWasCancelled
        ? ""The required project analysis was cancelled before completion.""
        : safeToolMessage(toolResult),
      recoveryState: ""INCOMPLETE"",
      evidenceAccepted: false,
    };
  }

  if (
    input.forensic === true
    && input.requiresEvidence === true
    && input.analysisEvidenceAccepted === true
  ) {
    return {
      outcome: ""SUCCEEDED"",
      retryable: false,
      recoveryState: ""NONE"",
      evidenceAccepted: true,
    };
  }

  const decision = record(latest(trace, ""decision_trace""));
  const auditState = record(latest(trace, ""audit_state""));
  const forensicStatus = {
    ...auditState,
    ...record(latest(trace, ""forensic_status"")),
  };
  const evidenceIntegrity = record(latest(trace, ""evidence_integrity""));
  const finalState = decision.finalState;
  const recoveryFailure = typeof decision.recoveryFailureKind === ""string""
    && decision.recoveryFailureKind.length > 0;
  const recoveryDiagnostic = hasDiagnostic(
    trace,
    /(?:RECOVERY_FAILED|RECOVERY_REQUIRED|CORRECTION_FAILED|CONTRACT_.*FAILED)/i,
  ) || hasForensicRecoveryBlocker(trace);
  const recoveryAttempted = trace.some((step) =>
    step.kind === ""forensic_recovery_start""
      || step.kind === ""recovery_model_call"",
  ) || recoveryFailure || recoveryDiagnostic;
  const capabilityProbeClaimUnclosed = hasDiagnostic(
    trace,
    /CAPABILITY_PROBE_(?:CLAIM_UNCLOSED|EVIDENCE_RECOVERY_REJECTED)/i,
  );
  const evidenceAttempted = input.evidenceAttempted
    ?? input.completeEvidenceAvailable
    ?? input.incompleteEvidenceAvailable
    ?? input.retainedEvidenceAvailable
    ?? false;
  const completeEvidenceAvailable = input.completeEvidenceAvailable
    ?? input.retainedEvidenceAvailable
    ?? false;
  const incompleteEvidenceAvailable = input.incompleteEvidenceAvailable ?? false;
  const requiredEvidencePending = input.requiredEvidencePending ?? false;
  const parseFailure = Boolean(
    input.result
    && typeof input.result === ""object""
    && ""_parseError"" in input.result
    && input.result._parseError,
  );

  // Execution evidence and forensic audit evidence are different contracts.
  // Only the authoritative route intent may activate forensic terminal rules;
  // delivery turns can require execution proof without becoming audits.
  const forensic = input.forensic === true;
  // A bounded JSON correction has already happened inside the orchestrator by
  // the time this classifier sees the result. Keep the turn non-successful,
  // but make it retryable and preserve any source evidence for the route's
  // deterministic fallback response.
  if (parseFailure) {
    return {
      outcome: ""FAILED"",
      failureKind: ""INCOMPLETE"",
      contractFailureCategory: ""MALFORMED_RESPONSE"",
      retryable: true,
      code: ""MODEL_OUTPUT_INVALID"",
      message: completeEvidenceAvailable
        ? ""The model response could not be parsed after a bounded correction, so the retained source evidence is shown as an incomplete result.""
        : ""The model response could not be parsed after a bounded correction, so the analysis is incomplete. Please retry."",
      recoveryState: completeEvidenceAvailable ? ""INCOMPLETE"" : ""REQUIRED"",
      evidenceAccepted: false,
    };
  }
  // A capability probe with retained source bodies but unclosed claims is a
  // terminal proof failure, not a resumable execution. The resume endpoint
  // deliberately rejects this checkpoint because replaying the same evidence
  // cannot establish the missing claim closure.
  if (forensic && capabilityProbeClaimUnclosed) {
    return {
      outcome: ""FAILED"",
      failureKind: ""INCOMPLETE"",
      retryable: false,
      code: ""FORENSIC_INCOMPLETE"",
      message: ""The capability probe retained source evidence, but its required claims remain unclosed."",
      recoveryState: ""INCOMPLETE"",
      evidenceAccepted: false,
    };
  }
  const providerFailureCategory = input.providerError
    ? classifyProviderFailure({
        ...input.providerError,
        cancelled,
      })
    : undefined;
  if (forensic && input.providerEmptyBeforeEvidence) {
    return {
      outcome: ""FAILED"",
      failureKind: ""INCOMPLETE"",
      contractFailureCategory: ""PROVIDER_EMPTY"",
      retryable: true,
      code: ""INCOMPLETE_BEFORE_EVIDENCE"",
      message: ""The result is incomplete because no source evidence was read."",
      recoveryState: ""INCOMPLETE"",
      evidenceAccepted: false,
    };
  }
  if (forensic && hasMalformedStructuredOutput(trace)) {
    return {
      outcome: ""FAILED"",
      failureKind: ""RECOVERY_FAILURE"",
      contractFailureCategory: ""MALFORMED_RESPONSE"",
      retryable: true,
      code: ""MALFORMED_STRUCTURED_OUTPUT"",
      message: ""The structured AI response could not be recovered into the required format."",
      recoveryState: ""REQUIRED"",
      evidenceAccepted: false,
    };
  }
  if (providerFailureCategory) {
    if (input.requiresEvidence && evidenceAttempted) {
      return {
        outcome: ""FAILED"",
        failureKind: ""INCOMPLETE"",
        providerFailureCategory,
        retryable: input.providerError?.retryable ?? true,
        code: ""INCOMPLETE_AFTER_PROVIDER_FAILURE"",
        message: ""The provider failed after source evidence was retained; the result is incomplete."",
        recoveryState: ""INCOMPLETE"",
        evidenceAccepted: false,
        ...(input.nextRequiredPath ? { nextRequiredPath: input.nextRequiredPath } : {}),
      };
    }
    const providerPolicy = decideProviderFailurePolicy({
      category: providerFailureCategory,
      fallbackAttempted: input.providerError?.fallbackExhausted === true,
      synthesisAvailable: false,
      deterministicRecoveryAvailable: recoveryAttempted,
      attempt: input.providerError?.fallbackExhausted === true ? 2 : 1,
    });
    return {
      outcome: ""FAILED"",
      failureKind: recoveryAttempted ? ""RECOVERY_FAILURE"" : ""INCOMPLETE"",
      providerFailureCategory,
      retryable: input.providerError?.retryable ?? providerPolicy.retryable,
      code: recoveryAttempted ? ""FORENSIC_RECOVERY_FAILED"" : ""AI_PROVIDER_FAILURE"",
      message: ""The AI provider could not complete the request."",
      recoveryState: recoveryAttempted ? ""REQUIRED"" : ""INCOMPLETE"",
      evidenceAccepted: false,
    };
  }
  if (forensic && (
    finalState === ""FAILED""
    || recoveryFailure
    || recoveryDiagnostic
  )) {
    return {
      outcome: ""FAILED"",
      failureKind: ""RECOVERY_FAILURE"",
      retryable: true,
      code: ""FORENSIC_RECOVERY_FAILED"",
      message: ""The forensic result could not be recovered into a complete, verified report."",
      recoveryState: ""REQUIRED"",
      evidenceAccepted: false,
    };
  }

  const text = responseText(input.result);
  const explicitIncomplete = forensic && (
    Boolean(input.endedBeforeEvidence)
      || hasDiagnostic(trace, /INCOMPLETE_BEFORE_EVIDENCE/i)
      || /\bANALYSIS_INCOMPLETE\b/i.test(text)
      || finalState === ""NOT_PROVEN""
      || finalState === ""RECOVERY_REQUIRED""
      || forensicStatus.behavioralAssessment === ""INCOMPLETE""
      || forensicStatus.sourceCoverage === ""PARTIAL""
      || forensicStatus.sourceCoverage === ""NONE""
      || auditState.behaviorAssessment === ""INCOMPLETE""
      || evidenceIntegrity.consistent === false
  );

  if (explicitIncomplete) {
    if (
      requiredEvidencePending
      && completeEvidenceAvailable
      && !incompleteEvidenceAvailable
    ) {
      return {
        outcome: ""FAILED"",
        failureKind: ""INCOMPLETE"",
        retryable: true,
        code: ""OBJECTIVE_INCOMPLETE"",
        message: input.nextRequiredPath
          ? ""The available source evidence is complete, but the objective still requires additional evidence.""
          : ""The available source evidence is complete, but the objective claims are not closed."",
        recoveryState: ""INCOMPLETE"",
        evidenceAccepted: false,
        ...(input.nextRequiredPath ? { nextRequiredPath: input.nextRequiredPath } : {}),
      };
    }
    if (evidenceAttempted && incompleteEvidenceAvailable) {
      return {
        outcome: ""FAILED"",
        failureKind: ""INCOMPLETE"",
        retryable: true,
        code: ""INCOMPLETE_AFTER_EVIDENCE_ATTEMPT"",
        message: ""The result is incomplete because one or more source reads were truncated or failed."",
        recoveryState: ""INCOMPLETE"",
        evidenceAccepted: false,
        ...(input.nextRequiredPath ? { nextRequiredPath: input.nextRequiredPath } : {}),
      };
    }
    return {
      outcome: ""FAILED"",
      failureKind: ""INCOMPLETE"",
      retryable: true,
      code: input.endedBeforeEvidence ? ""INCOMPLETE_BEFORE_EVIDENCE"" : ""FORENSIC_INCOMPLETE"",
      message: input.endedBeforeEvidence
        ? ""The result is incomplete because no source evidence was read.""
        : ""The forensic result is incomplete and is not proven."",
      recoveryState: ""INCOMPLETE"",
      evidenceAccepted: false,
    };
  }

  const acceptedNoFinding = input.requiresEvidence === true
    && forensicStatus.findingStatus === ""NO_FINDING""
    && forensicStatus.sourceCoverage === ""COMPLETE""
    && forensicStatus.behavioralAssessment === ""COMPLETE""
    && finalState === ""VERIFIED""
    && evidenceIntegrity.consistent === true;
  const acceptedFinding = input.requiresEvidence === true
    && forensicStatus.findingStatus === ""PROVEN""
    && forensicStatus.sourceCoverage === ""COMPLETE""
    && forensicStatus.behavioralAssessment === ""COMPLETE""
    && finalState === ""VERIFIED""
    && evidenceIntegrity.consistent === true
    && Number(evidenceIntegrity.acceptedClaimCount ?? 0) > 0
    && Number(evidenceIntegrity.acceptedEvidenceCount ?? 0) > 0;
  const taskResult = input.result && typeof input.result === ""object""
    ? (input.result as { taskResult?: unknown }).taskResult
    : undefined;
  const acceptedCapabilityProbe = input.requiresEvidence === true
    && taskResult
    && typeof taskResult === ""object""
    && (taskResult as { kind?: unknown }).kind === ""CAPABILITY_PROBE_RESULT""
    && (taskResult as { score?: unknown }).score === 7
    && (taskResult as { coverage?: { complete?: unknown } }).coverage?.complete === true;
  const missingForensicContract = forensic
    && input.requiresEvidence === true
    && !forensicStatus.sourceCoverage
    && !forensicStatus.findingStatus
    && !evidenceIntegrity.evidenceSourceCoverage
    && !finalState;

  if (forensic && input.requiresEvidence === true && !acceptedNoFinding && !acceptedFinding && !acceptedCapabilityProbe) {
    if (missingForensicContract) {
      // Let the durable completion gate publish the stable acceptance error.
      // This avoids turning a provider response with no server-owned contract
      // into a provider/recovery failure while still preventing completion.
      return {
        outcome: ""SUCCEEDED"",
        retryable: false,
        code: ""FORENSIC_ACCEPTANCE_REQUIRED"",
        message: ""The forensic response has no server-owned acceptance contract."",
        recoveryState: ""INCOMPLETE"",
        evidenceAccepted: false,
      };
    }
    return {
      outcome: ""FAILED"",
      failureKind: ""INCOMPLETE"",
      retryable: !hasForensicRecoveryBlocker(trace),
      code: hasForensicRecoveryBlocker(trace)
        ? ""FORENSIC_RECOVERY_FAILED""
        : ""FORENSIC_EVIDENCE_NOT_ACCEPTED"",
      message: hasForensicRecoveryBlocker(trace)
        ? ""The forensic result could not be recovered into a complete, verified report.""
        : ""The forensic result did not pass the complete evidence gates."",
      recoveryState: ""INCOMPLETE"",
      evidenceAccepted: false,
    };
  }

  return {
    outcome: ""SUCCEEDED"",
    retryable: false,
    recoveryState: ""NONE"",
    evidenceAccepted: acceptedNoFinding || acceptedFinding || Boolean(acceptedCapabilityProbe) || input.requiresEvidence !== true,
  };
}
```",2026-09-19T21:01:34.550Z
d4590f30-f555-4270-9402-d6088a3c692f,8e78c54c-23e5-445e-85ec-6e3816154184,artifacts/api-server/src/routes/ai/chat.ts,source,5226,7568,adcecec6b3a70ace83d9eed3652cc7d85225eb2bc4d9bccb0edf1e3dfa1444de,96499,1,0,"File: artifacts/api-server/src/routes/ai/chat.ts
```
          cacheMode: contextExecutionPlan.cacheMode,
        },
      },
      executionHandoff: {
        requested: immediateExecutionRequest || turnIntent.compoundWrite,
        compoundExecution: turnIntent.compoundExecution,
        phases: turnIntent.phases,
        sessionId: existingSession?.id ?? sessionId ?? null,
        historyMessageCount: historyRows.length,
        repairPlanCandidateCount: countRepairPlanCandidates(historyRows),
      },
    }, ""chat: dispatching chatWithFallback"");

    let result = undefined as unknown as Awaited<ReturnType<typeof chat>>;
    const traceSteps: AgentStep[] = [];
    const retainedEvidence = new Map<string, string>();
    const retainedReadStatuses = new Map<string, ReadStatus>();
    let providerFailureAfterEvidence: GroqClientError | undefined;
    const sessionIdToUse = existingSession?.id ?? sessionId ?? randomUUID();
    try {
      const chatOut = await chatWithFallback(
        req.userId,
        {
          message,
          history: projectProviderHistory(historyRows, providerHistoryPolicy),
          projectContext,
          executionPlan: contextExecutionPlan,
          rootPath: validRootPath,
          projectId,
           previouslyAcceptedEvidence: projectQueryPreviouslyAcceptedEvidence,
          activeTaskState: resumableStateForTurn,
          activeTask,
          telemetryContext: {
            projectId,
            userId: req.userId,
            operationId: analysisCorrelation.operationId,
            correlationId: analysisCorrelation.operationId,
          },
          productionTraceLinks: runtimeChatTraceLinks(""POST /api/ai/chat""),
          objective: effectiveObjective,
          turnIntent,
           retainedEvidence,
           retainedReadStatuses,
          allowValidationTools: Boolean(validationRunner),
           approvalState: validationRunner
             ? ""APPROVED""
             : turnIntent.compoundWrite
               ? ""PENDING_APPROVAL""
               : undefined,
          validationRunner,
          approvedValidationProfiles: validationRunner ? [""workspace-typecheck""] : undefined,
           approvedFilePaths: turnIntent.compoundWrite
             ? compoundValidationTargetPaths(message)
             : undefined,
          validationTargetPaths: validationOnlyTargetPaths,
          allowAnalysisTools: Boolean(modelHasTools && analysisToolRunner),
          analysisToolRunner,
          analysisCorrelation,
          executionLedger,
          onProviderAttempt: (attempt) => recordAiUsageAttempt({
            projectId,
            userId: req.userId,
            operationId: analysisCorrelation.operationId ?? sessionIdToUse,
            correlationId: analysisCorrelation.operationId ?? sessionIdToUse,
          }, {
            ...attempt,
            attemptId: attempt.attemptId
              ?? `${analysisCorrelation.operationId ?? sessionIdToUse}:${attempt.operation ?? ""provider""}:${attempt.provider}:${attempt.attemptNumber}`,
            usageStatus: attempt.usageStatus,
            promptTokens: attempt.promptTokens,
            completionTokens: attempt.completionTokens,
          }),
        },
        { provider, apiKey },
        undefined,
        { requireTools: modelHasTools, qualityProfile: turnIntent.executionTaskType },
        undefined,
        (step) => traceSteps.push(step),
      );
      result = terminalizeUnsupportedChatResponse(chatOut.result);
      if (result._parseError) {
        result = {
          ...result,
          response: buildModelOutputInvalidResponse(
            turnIntent.kind,
            message,
            retainedEvidence,
          ),
          sources: [...retainedEvidence.keys()],
          pendingChanges: [],
          repairPlan: undefined,
          taskResult: undefined,
          behaviorEvidence: undefined,
        };
      }
      if (turnIntent.requiresEvidence && endedBeforeFirstSourceRead(traceSteps)) {
        result = {
          ...result,
          response: failClosedBeforeEvidenceResponse(message),
          sources: [],
          pendingChanges: [],
          repairPlan: undefined,
          taskResult: undefined,
          behaviorEvidence: undefined,
        };
      }
    } catch (err) {
      if (err instanceof GroqClientError) {
        const providerEvidenceSummary = summarizeEvidenceForFailure(
          traceSteps,
          retainedEvidence,
          retainedReadStatuses,
        );
        if (turnIntent.requiresEvidence && providerEvidenceSummary.sourceReadCount > 0) {
          providerFailureAfterEvidence = err;
          result = {
            response: buildProviderFailureEvidenceResponse(
              turnIntent.kind,
              message,
              retainedEvidence,
            ),
            sources: [...retainedEvidence.keys()],
            pendingChanges: [],
            repairPlan: undefined,
            taskResult: undefined,
            behaviorEvidence: undefined,
          };
        } else {
        const failureEvidenceProgress = deriveEvidenceProgressCheckpoint({
          objective: effectiveObjective,
          traceSteps,
          retainedEvidence,
          operationId: analysisCorrelation.operationId ?? sessionIdToUse,
          sourceRevision: analysisCorrelation.projectRevision,
        });
        const terminalOutcome = classifyAiTerminalOutcome({
          trace: traceSteps,
          requiresEvidence: turnIntent.requiresEvidence,
          forensic: turnIntent.kind === ""FORENSIC_AUDIT""
            || (isCapabilityProbeRequest(message) && turnIntent.requiresEvidence),
          cancelled: false,
          endedBeforeEvidence: turnIntent.requiresEvidence && endedBeforeFirstSourceRead(traceSteps),
          ...terminalEvidenceState(providerEvidenceSummary, failureEvidenceProgress),
          providerEmptyBeforeEvidence:
            turnIntent.requiresEvidence
            && err.code === ""EMPTY_RESPONSE""
            && endedBeforeFirstSourceRead(traceSteps),
          providerError: {
            code: err.code,
            providerCode: err.providerCode,
            providerStatus: err.providerStatus,
            fallbackExhausted: true,
            retryable: err.code === ""TIMEOUT""
              || err.code === ""NETWORK_ERROR""
              || err.code === ""SERVER_ERROR""
              || err.code === ""RATE_LIMITED"",
          },
        });
        await persistFailedChatTurn({
          sessionId: sessionIdToUse,
          projectId,
          message,
          turnIntent: turnIntent.kind,
          activeTaskState: resumableTaskStateAtStart,
          linkedTaskId: effectiveLinkedTaskId,
          createSessionIfMissing: true,
          outcome: ""FAILED"",
          errorCode: err.code,
          errorMessage: ""The AI provider could not complete the request."",
          createdAt: now,
          assistantAt: msgNow,
          toolTrace: traceSteps,
          terminalOutcome,
          contextProvenance: projectContext.contextProvenance ?? projectContextProvenance(projectContext),
        }).catch((persistError) => {
          logger.error({ persistError, sessionId: sessionIdToUse }, ""chat: failed to persist provider failure"");
        });
        if (handleOrchestratorError(err, res, {
          projectId,
          operation: ""chat"",
          provider,
          publicContract: ""chat"",
          executionLedger,
          incompleteReview: { sessionId: sessionIdToUse },
        })) return;
        }
      }
      if (!result) throw err;
    }

    const terminalEvidenceSummary = summarizeEvidenceForFailure(
      traceSteps,
      retainedEvidence,
      retainedReadStatuses,
    );
    const terminalEvidenceProgress = deriveEvidenceProgressCheckpoint({
      objective: effectiveObjective,
      traceSteps,
      retainedEvidence,
      operationId: analysisCorrelation.operationId ?? sessionIdToUse,
      sourceRevision: analysisCorrelation.projectRevision,
    });
    const terminalOutcome = classifyAiTerminalOutcome({
      result,
      trace: traceSteps,
      requiresEvidence: turnIntent.requiresEvidence,
      forensic: turnIntent.kind === ""FORENSIC_AUDIT""
        || (isCapabilityProbeRequest(message) && turnIntent.requiresEvidence),
      endedBeforeEvidence: turnIntent.requiresEvidence && endedBeforeFirstSourceRead(traceSteps),
      ...terminalEvidenceState(terminalEvidenceSummary, terminalEvidenceProgress),
      ...(providerFailureAfterEvidence
        ? {
            providerError: {
              code: providerFailureAfterEvidence.code,
              providerCode: providerFailureAfterEvidence.providerCode,
              providerStatus: providerFailureAfterEvidence.providerStatus,
              fallbackExhausted: true,
              retryable: providerFailureAfterEvidence.code === ""RATE_LIMITED""
                || providerFailureAfterEvidence.code === ""TIMEOUT""
                || providerFailureAfterEvidence.code === ""NETWORK_ERROR""
                || providerFailureAfterEvidence.code === ""SERVER_ERROR"",
            },
          }
        : {}),
    });
    executionLedgerSnapshot = finishExecutionLedger(executionLedger, {
      outcome: terminalOutcome.outcome,
      trace: traceSteps,
    });
    if (terminalOutcome.outcome !== ""SUCCEEDED"") {
      const forensicDiagnostic = deriveForensicDiagnostic(traceSteps);
      const safeMessage = redactUserFacingText(
        terminalOutcome.message ?? ""The AI request did not complete."",
      ).slice(0, 500);
      const report = terminalOutcome.failureKind === ""TOOL_FAILURE""
        ? undefined
        : result.response;
      const failedMessage = await persistFailedChatTurn({
        sessionId: sessionIdToUse,
        projectId,
        message,
        turnIntent: turnIntent.kind,
        activeTaskState: resumableTaskStateAtStart,
        linkedTaskId: effectiveLinkedTaskId,
        createSessionIfMissing: true,
        outcome: terminalOutcome.outcome,
        errorCode: terminalOutcome.code ?? ""AI_EXECUTION_INCOMPLETE"",
        errorMessage: safeMessage,
        content: report,
        sources: collectReadEvidencePaths(traceSteps),
        taskResult: result.taskResult,
        behaviorEvidence: result.behaviorEvidence,
        repairPlanMetadata: result.repairPlan,
        terminalOutcome,
        createdAt: now,
        assistantAt: msgNow,
        toolTrace: traceSteps,
        executionLedgerSnapshot,
        contextProvenance: projectContext.contextProvenance ?? projectContextProvenance(projectContext),
      }) ?? {
        id: randomUUID(),
        sessionId: sessionIdToUse,
        role: ""assistant"",
        content: report ? sanitizeResponseText(report).slice(0, 12_000) : """",
        outcome: terminalOutcome.outcome,
        errorCode: terminalOutcome.code ?? ""AI_EXECUTION_INCOMPLETE"",
        errorMessage: safeMessage,
        toolTrace: appendExecutionLedgerTrace(
          appendContextProvenanceTrace(
            serializeToolTrace(traceSteps, true),
            projectContext.contextProvenance ?? projectContextProvenance(projectContext),
          ),
          executionLedgerSnapshot,
        ),
        createdAt: msgNow,
        acceptanceDisposition: publicAcceptanceDisposition({
          code: terminalOutcome.code,
          outcome: terminalOutcome.outcome,
          failureKind: terminalOutcome.failureKind,
          recoveryState: terminalOutcome.recoveryState,
        }),
        ...(terminalOutcome.providerFailureCategory
          ? { providerFailureCategory: terminalOutcome.providerFailureCategory }
          : {}),
        ...(terminalOutcome.contractFailureCategory
          ? { contractFailureCategory: terminalOutcome.contractFailureCategory }
          : {}),
        contextProvenance: projectContext.contextProvenance ?? projectContextProvenance(projectContext),
      };
      // The HTTP request completed, but the assistant turn did not. Keep the
      // response transport-compatible with normal chat while making the
      // terminal non-success explicit in every field.
      return res.status(200).json({
        sessionId: sessionIdToUse,
        turnIntent: turnIntent.kind,
        outcome: terminalOutcome.outcome,
        failureKind: terminalOutcome.failureKind,
        retryable: terminalOutcome.retryable,
        recoveryState: terminalOutcome.recoveryState,
        ...(terminalOutcome.nextRequiredPath
          ? { nextRequiredPath: terminalOutcome.nextRequiredPath }
          : {}),
        ...(terminalOutcome.providerFailureCategory
          ? { providerFailureCategory: terminalOutcome.providerFailureCategory }
          : {}),
        ...(terminalOutcome.contractFailureCategory
          ? { contractFailureCategory: terminalOutcome.contractFailureCategory }
          : {}),
        code: terminalOutcome.code,
        error: safeMessage,
        errorMessage: safeMessage,
        message: {
          ...failedMessage,
          ...(projectQueryTargetFromTrace(failedMessage.toolTrace)
            ? { projectQueryTarget: projectQueryTargetFromTrace(failedMessage.toolTrace) }
            : {}),
          failureKind: terminalOutcome.failureKind,
          retryable: terminalOutcome.retryable,
          recoveryState: terminalOutcome.recoveryState,
          ...(terminalOutcome.nextRequiredPath
            ? { nextRequiredPath: terminalOutcome.nextRequiredPath }
            : {}),
          ...(terminalOutcome.providerFailureCategory
            ? { providerFailureCategory: terminalOutcome.providerFailureCategory }
            : {}),
          ...(terminalOutcome.contractFailureCategory
            ? { contractFailureCategory: terminalOutcome.contractFailureCategory }
            : {}),
          ...(terminalOutcome.contractFailureCategory
            ? { contractFailureCategory: terminalOutcome.contractFailureCategory }
            : {}),
          acceptanceDisposition: publicAcceptanceDisposition({
            code: terminalOutcome.code,
            outcome: terminalOutcome.outcome,
            failureKind: terminalOutcome.failureKind,
            recoveryState: terminalOutcome.recoveryState,
          }),
          executionLedger: executionLedgerSnapshot,
          contextProvenance: projectContext.contextProvenance ?? projectContextProvenance(projectContext),
          ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
        },
        executionLedger: executionLedgerSnapshot,
        ...(projectQueryTargetFromTrace(failedMessage.toolTrace)
          ? { projectQueryTarget: projectQueryTargetFromTrace(failedMessage.toolTrace) }
          : {}),
        contextProvenance: projectContext.contextProvenance ?? projectContextProvenance(projectContext),
        ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
        ...(report ? { report: sanitizeResponseText(report).slice(0, 12_000) } : {}),
      });
    }

    if (result._qualityError) {
      const quality = publicQualityFailure(result._qualityError);
      const safeMessage = ""The AI result did not meet the quality checks required for completion."";
      const forensicDiagnostic = turnIntent.requiresEvidence
        ? deriveForensicDiagnostic(traceSteps)
        : undefined;
      await persistFailedChatTurn({
        sessionId: sessionIdToUse,
        projectId,
        message,
        turnIntent: turnIntent.kind,
        activeTaskState: resumableTaskStateAtStart,
        executionId: undefined,
        outcome: ""FAILED"",
        errorCode: quality.code,
        errorMessage: safeMessage,
        createdAt: now,
        assistantAt: msgNow,
        toolTrace: traceSteps,
        executionLedgerSnapshot,
        contextProvenance: projectContext.contextProvenance ?? projectContextProvenance(projectContext),
        terminalOutcome: {
          failureKind: ""QUALITY_REVIEW"",
          retryable: true,
          recoveryState: ""REQUIRED"",
        },
      }).catch((persistError) => logger.error({ persistError, sessionId: sessionIdToUse }, ""quality failure persistence failed""));
      return res.status(422).json({
        error: ""quality_review_low"",
        code: quality.code,
        outcome: ""FAILED"",
        failureKind: ""QUALITY_REVIEW"",
        retryable: true,
        recoveryState: ""REQUIRED"",
        quality,
        errorMessage: safeMessage,
        executionLedger: executionLedgerSnapshot,
        contextProvenance: projectContext.contextProvenance ?? projectContextProvenance(projectContext),
        ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
      });
    }

    if (result._parseError) {
      const forensicDiagnostic = turnIntent.requiresEvidence
        ? deriveForensicDiagnostic(traceSteps)
        : undefined;
      return res.status(422).json({
        error: ""model_output_invalid"",
        code: ""model_output_invalid"",
        outcome: ""FAILED"",
        failureKind: ""PROVIDER_FAILURE"",
        retryable: false,
        recoveryState: ""REQUIRED"",
        correlationId: randomUUID(),
        executionLedger: executionLedgerSnapshot,
         contextProvenance: projectContext.contextProvenance ?? projectContextProvenance(projectContext),
        ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
      });
    }

    let missionCorrelationReport: string | null;
    try {
      missionCorrelationReport = serializeMissionCorrelationReport(
        (result as { missionCorrelationReport?: unknown }).missionCorrelationReport,
      );
    } catch (error) {
      if (error instanceof MissionCorrelationReportValidationError) {
        const forensicDiagnostic = turnIntent.requiresEvidence
          ? deriveForensicDiagnostic(traceSteps)
          : undefined;
        return res.status(422).json({
          error: ""The forensic report could not be validated and was not completed."",
          code: error.code,
          outcome: ""FAILED"",
          failureKind: ""RECOVERY_FAILURE"",
          retryable: true,
          recoveryState: ""REQUIRED"",
          correlationId: randomUUID(),
           contextProvenance: projectContext.contextProvenance ?? projectContextProvenance(projectContext),
          ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
        });
      }
      throw error;
    }

    // Public source metadata is server-owned. Provider-reported paths that do
    // not have a matching read trace are not current sources for this turn.
    result = {
      ...result,
      sources: collectVerifiedTurnSources(result, traceSteps),
      taskResult: normalizeTaskResultForTurn(turnIntent.kind, result.taskResult),
    };

    // Chat turns don't modify project data — no cache invalidation needed.
    // Full invalidation happens only in /apply-changes when files are written.

    // Atomic: session creation (when needed) + user message + assistant message
    // + session timestamp update in one transaction — prevents a half-saved
    // conversation if one insert fails.
    const compoundSourceReadObserved = turnIntent.compoundWrite && traceSteps.some(
      (step) =>
        step.kind === ""tool_result"" &&
        (step.tool === ""read_file"" || step.tool === ""read_file_range""),
    );
    const proposalChanges = bindPendingChangesToCompoundWrite(
      bindPendingChangesToRepairPlan(
        (result.pendingChanges ?? []) as ServerPendingChange[],
        result.repairPlan,
      ),
      !turnIntent.compoundWrite || compoundSourceReadObserved,
    );
    const proposalId = (!turnIntent.compoundWrite || compoundSourceReadObserved) && canCreateProposal(
      proposalChanges,
      result.repairPlan,
      hasPassedLatestValidation(traceSteps),
      traceSteps,
    )
      ? randomUUID()
      : undefined;
    const executionPlan = buildActiveTaskExecutionPlan({
      repairPlan: result.repairPlan,
      implementationPlan: result.taskResult?.kind === ""IMPLEMENTATION_PLAN_RESULT""
        ? result.taskResult
        : undefined,
      objective: result.objective ?? objective,
      evidence: result.behaviorEvidence,
      projectId,
      rootPath: validRootPath,
    });
    if (!executionLedgerSnapshot) {
      executionLedgerSnapshot = finishExecutionLedger(executionLedger, {
        outcome: ""SUCCEEDED"",
        trace: traceSteps,
      });
    }
    const activeTaskState = nextSessionTaskState({
      persisted: resumableStateForTurn,
      classification: chatClassification,
      effectiveTurnKind: turnIntent.kind,
      resumed: classificationResolution.resumed,
      projectId,
      rootPath: validRootPath,
      linkedTaskId: effectiveLinkedTaskId,
      revision: analysisCorrelation.projectRevision,
      capabilityProbe: isCapabilityProbeRequest(message) || Boolean(resumableStateForTurn?.capabilityProbe),
      projectQuery: effectiveProjectQuery,
      projectQueryObjective: effectiveObjective,
      forcePersist: turnIntent.kind === ""FORENSIC_AUDIT"",
      now: msgNow,
      readFiles: collectReadEvidencePaths(traceSteps),
      executionPlan,
    });
    const assistantMessageId = randomUUID();
    const preparedDeliveryWorkspace = proposalId && proposalChanges.length > 0
      ? await createDeliveryWorkspace({
          rootPath: validRootPath ?? project.rootPath,
          operationId: assistantMessageId,
          baseRevision: analysisCorrelation.projectRevision ?? project.updatedAt.toISOString(),
          changes: proposalChanges.map((change) => ({
            path: change.path,
            newContent: change.newContent,
          })),
        })
      : undefined;

    const assistantMsg = await db.transaction(async (tx) => {
      if (existingSession) {
        await tx
          .select({ id: aiChatSessionsTable.id })
          .from(aiChatSessionsTable)
          .where(eq(aiChatSessionsTable.id, sessionIdToUse))
          .for(""update"");
      }
      if (!existingSession) {
        const [created] = await tx
          .insert(aiChatSessionsTable)
          .values({
            id: sessionIdToUse,
            projectId,
            // AI-TASK-001: persist task linkage so re-opened sessions remain task-aware.
            linkedTaskId: effectiveLinkedTaskId ?? null,
            activeTaskState,
            // BUG-5 fix: don't use a bare greeting as the session title.
            // ""مرحبا"", ""Hello"", ""Hi"" etc. give no context in the sessions list.
            // Use the first 60 chars only when the opener is substantive.
            title: (() => {
              const trimmed = message.trim();
              const isGreeting = /^(مرحبا|مرحبً?ا|أهلاً?|سلام|هلا|hi|hello|hey|greetings|سلاماً?|صباح الخير|مساء الخير|good (morning|afternoon|evening))[\s!.،,]*$/i.test(trimmed);
              return (!isGreeting && trimmed.length > 10)
                ? trimmed.slice(0, 60)
                : `Session ${now.toISOString().slice(0, 16).replace(""T"", "" "")}`;
            })(),
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        if (!created) {
          throw new Error(""Failed to create chat session"");
        }
      }
      await tx.insert(aiChatMessagesTable).values({
        id: randomUUID(),
        sessionId: sessionIdToUse,
        role: ""user"",
        content: message,
        turnIntent: turnIntent.kind,
        outcome: ""SUCCEEDED"",
        createdAt: now,
      });
      const [msg] = await tx
        .insert(aiChatMessagesTable)
        .values({
          id: assistantMessageId,
          sessionId: sessionIdToUse,
          role: ""assistant"",
          content: sanitizeResponseText(result.response),
          turnIntent: turnIntent.kind,
          outcome: ""SUCCEEDED"",
          sources: JSON.stringify(result.sources),
          toolTrace: appendExecutionLedgerTrace(
            appendContextProvenanceTrace(
              serializeToolTrace(traceSteps),
              projectContext.contextProvenance ?? projectContextProvenance(projectContext),
            ),
            executionLedgerSnapshot!,
          ),
          repairPlanMetadata: serializeRepairPlanMetadata(result.repairPlan),
          behaviorEvidence: serializeBehaviorEvidence(result.behaviorEvidence),
          missionCorrelationReport,
          taskResult: serializeTaskResult(result.taskResult),
          executionId: null,
          createdAt: msgNow,
        })
        .returning();
      if (proposalId || result.repairPlan || result.taskResult?.kind === ""IMPLEMENTATION_PLAN_RESULT"") {
        const operationId = msg.id;
        if (proposalId) {
        await tx.insert(aiChangeProposalsTable).values({
          id: proposalId,
          projectId,
          sessionId: sessionIdToUse,
          messageId: operationId,
          changes: serializeServerPendingChanges(proposalChanges),
          status: ""pending"",
           ...(preparedDeliveryWorkspace
             ? {
                 operationId: preparedDeliveryWorkspace.operationId,
                 workspaceRoot: preparedDeliveryWorkspace.workspaceRoot,
                 baseRevision: preparedDeliveryWorkspace.baseRevision,
                 baseTreeHash: preparedDeliveryWorkspace.baseTreeHash,
                 candidateTreeHash: preparedDeliveryWorkspace.candidateTreeHash,
                 treeDigestVersion: DELIVERY_TREE_DIGEST_VERSION,
                 changeSetHash: preparedDeliveryWorkspace.changeSetHash,
               }
             : {}),
          createdAt: msgNow,
        });
        }
        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: ""AiPlanCreated"",
          projectId,
          severity: ""info"",
          message: ""AI implementation plan created and is awaiting approval"",
          correlationId: operationId,
          payload: { messageId: operationId, proposalId: proposalId ?? null },
        });
      }
      const [sessionStateWrite] = await tx
        .update(aiChatSessionsTable)
        .set({
          activeTaskState,
          updatedAt: sql`GREATEST(${aiChatSessionsTable.updatedAt}, ${msgNow})`,
        })
        .where(and(
          eq(aiChatSessionsTable.id, sessionIdToUse),
          sessionTaskStateIsAtOrBefore(msgNow),
        ))
        .returning({ id: aiChatSessionsTable.id });
      if (!sessionStateWrite && activeTaskState) {
        const [currentSession] = await tx
          .select({
            activeTaskState: aiChatSessionsTable.activeTaskState,
            updatedAt: aiChatSessionsTable.updatedAt,
          })
          .from(aiChatSessionsTable)
          .where(eq(aiChatSessionsTable.id, sessionIdToUse))
          .limit(1);
        if (
          currentSession
          && !currentSession.activeTaskState
          && currentSession.updatedAt <= msgNow
        ) {
          const [repairedStateWrite] = await tx
            .update(aiChatSessionsTable)
            .set({
              activeTaskState,
              updatedAt: sql`GREATEST(${aiChatSessionsTable.updatedAt}, ${msgNow})`,
            })
            .where(eq(aiChatSessionsTable.id, sessionIdToUse))
            .returning({ id: aiChatSessionsTable.id });
          logger.warn({
            scope: ""chat-route"",
            action: ""terminal_state_repair"",
            sessionId: sessionIdToUse,
            executionId: null,
            applied: Boolean(repairedStateWrite),
          }, ""chat stream: repaired missing terminal session task state"");
        }
      }
      return msg;
    });
    // Evidence-bound and forensic plans are stateless in both directions:
    // do not persist their source-derived response as future navigation memory.
    const orientationMemoryAllowed =
      !isProjectOrientationQuestion(message)
      || result.sourceSelectionRecord?.orientationCoverage?.complete === true;
    if (contextExecutionPlan.taskProfile.memoryMode !== ""none"" && orientationMemoryAllowed) {
      try {
        await writeSessionMemories(
          sessionIdToUse,
          projectId,
          collectReadEvidencePaths(traceSteps),
          sanitizeResponseText(result.response),
          assistantMsg.id,
          {
            outcome: ""SUCCEEDED"",
            turnIntent: turnIntent.kind,
            memoryMode: contextExecutionPlan.taskProfile.memoryMode,
            userMessage: message,
            taskScope: contextExecutionPlan.taskProfile.scope,
            projectRevision: projectContext.workspaceRevision ?? analysisCorrelation.projectRevision,
            taskResult: result.taskResult,
          },
        );
      } catch (err) {
        logger.warn({ err, projectId }, ""memory-write: failed to persist session memories"");
      }
    }

    const forensicDiagnostic = turnIntent.requiresEvidence && turnIntent.kind !== ""PROJECT_QUERY""
      ? deriveForensicDiagnostic(traceSteps)
      : undefined;
    const projectQueryTarget = projectQueryTargetFromTrace(assistantMsg.toolTrace);
    const sourceSelectionRecord = result.sourceSelectionRecord ?? undefined;
    return res.json({
      sessionId: sessionIdToUse,
      message: {
        ...assistantMsg,
        taskResult: parseTaskResult(assistantMsg.taskResult),
        ...(projectQueryTarget ? { projectQueryTarget } : {}),
        ...(sourceSelectionRecord ? { sourceSelectionRecord } : {}),
        contextProvenance: projectContext.contextProvenance ?? projectContextProvenance(projectContext),
        ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
      },
      executionLedger: executionLedgerSnapshot,
      turnIntent: turnIntent.kind,
      outcome: ""SUCCEEDED"",
      contextProvenance: projectContext.contextProvenance ?? projectContextProvenance(projectContext),
      sources: parseStoredJson(assistantMsg.sources) ?? [],
      toolTrace: assistantMsg.toolTrace,
      ...(projectQueryTarget ? { projectQueryTarget } : {}),
      ...(sourceSelectionRecord ? { sourceSelectionRecord } : {}),
      ...(forensicDiagnostic ? { forensicDiagnostic } : {}),
      pendingChanges: proposalId
        ? proposalChanges
        : [],
      proposalId,
      proposalUnavailable: (result.pendingChanges?.length ?? 0) > 0 && !proposalId
        ? hasPassedLatestValidation(traceSteps)
          ? ""Repair changes require closed Finding/claim evidence before approval.""
          : ""Repair changes require a verified validation profile before approval.""
        : undefined,
      repairPlan: redactUserFacingValue(result.repairPlan),
      productionReachability: result.productionReachability,
      crossFileTraces: redactUserFacingValue(result.crossFileTraces),
      // Exact source line spans for each accepted behavior-evidence excerpt so the
      // dashboard can show where the proof comes from.
      behaviorEvidence: redactUserFacingValue(result.behaviorEvidence),
      // AI-008: per-task typed result discriminated on `kind` by forensicTaskType
      taskResult: redactUserFacingValue(result.taskResult),
      _meta: rootFallbackUsed
        ? { rootPathFallback: { used: true, original: rootOriginalPath } }
        : undefined,
    });
  } finally {
    await applyProbe.release();
  }
});

// ── POST /api/ai/chat/stream ─────────────────────────────────────────────────

export async function handleChatStream(req: Request, res: Response) {
  const ChatBodySchema = z.object({
    projectId:    z.string({ required_error: ""projectId is required"" }).min(1, ""projectId is required""),
    message:      z.string({ required_error: ""message is required"" }).trim().min(1, ""message is required""),
    sessionId:    z.string().uuid(""sessionId must be a valid UUID"").optional(),
    // AI-TASK-002: optional task linkage — switches agent into task-aware mode
    linkedTaskId: z.string().uuid(""linkedTaskId must be a valid UUID"").optional(),
    /**
     * Build handoff from a previously approved implementation plan. The
     * server validates this message before model execution and enforces its
     * declared file scope before creating a change proposal.
     */
    buildPlanMessageId: z.string().uuid(""buildPlanMessageId must be a valid UUID"").optional(),
    /** Durable execution identity used to reconnect or explicitly resume a run. */
    executionId: z.string().uuid(""executionId must be a valid UUID"").optional(),
    /** Opaque token returned with execution_started; never accepted from model content. */
    resumeToken: z.string().min(32).max(128).optional(),
    /** Client retry key; repeated requests reuse the same durable execution. */
    idempotencyKey: z.string().min(8).max(128).optional(),
    // AI-OBJ-005: optional validated Objective Completion contract; when present
    // the chat() call runs the Objective Completion Gate on the real entry point
    // and refuses finalization while any required claim/edge is unproven.
    objective:    ObjectiveContractSchema.optional(),
  });
  const chatBody = ChatBodySchema.safeParse(req.body);
  if (!chatBody.success) {
    const issue = chatBody.error.issues[0];
    const raw   = issue?.message ?? ""Invalid request body"";
    const field = String(issue?.path[0] ?? """");
    const error = raw === ""Required"" && field ? `${field} is required` : raw;
    return res.status(400).json({ error });
  }
  const {
    projectId,
    message,
    sessionId: requestedSessionId,
    linkedTaskId,
    objective,
    buildPlanMessageId,
    executionId,
    resumeToken,
    idempotencyKey,
  } = chatBody.data;
  const rawTurnClassification = classifyRequest(message);
  const rawTurnIntent = resolveTurnIntent(message, {
    classification: rawTurnClassification,
  });
  let isolatedConversationTurn =
    rawTurnIntent.kind === ""CHAT""
    && !rawTurnIntent.serverAction
    && !isTaskContinuationRequest(message);
  const effectiveExecutionId = isolatedConversationTurn ? undefined : executionId;
  const effectiveResumeToken = isolatedConversationTurn ? undefined : resumeToken;

  const project = await loadProjectByIdForUser(projectId, req.userId, res);
  if (!project) return;

  const sessionQualityAudit = isSessionQualityAuditRequest(message);
  let sessionId = requestedSessionId;
  if (sessionQualityAudit && !sessionId) {
    const latestSession = await resolveLatestProjectChatSession(projectId);
    if (!latestSession) {
      const payload = latestSessionQualityIncompletePayload(message);
      res.status(200);
      res.setHeader(""Content-Type"", ""text/event-stream"");
      res.setHeader(""Cache-Control"", ""no-cache, no-transform"");
      res.setHeader(""Connection"", ""keep-alive"");
      res.setHeader(""X-Accel-Buffering"", ""no"");
      res.flushHeaders();
      res.write(serializeAiSseEvent({
        type: ""intent"",
        intent: payload.turnIntent,
        operationMode: ""CHAT"",
        requiresEvidence: true,
        sessionQuality: payload.sessionQuality,
      }));
      res.write(serializeAiSseEvent({
        type: ""done"",
        ...payload,
        message: {
          id: randomUUID(),
          sessionId: null,
          role: ""assistant"",
          content: payload.error,
          outcome: payload.outcome,
          errorCode: payload.code,
          errorMessage: payload.errorMessage,
          turnIntent: payload.turnIntent,
          createdAt: new Date().toISOString(),
        },
        sources: [],
        toolTrace: ""[]"",
        pendingChanges: [],
        sessionQuality: payload.sessionQuality,
      }));
      res.end();
      return;
    }
    sessionId = latestSession.id;
  }

  if (rawTurnIntent.serverAction === ""RESTART_SERVICES"") {
    try {
      const workflow = await startInternalRestartServicesWorkflow({
        userId: req.userId,
        projectId,
        rootPath: project.rootPath,
        revision: project.updatedAt.toISOString(),
      });
      const outcome = workflow.workflowStatus === ""completed"" ? ""SUCCEEDED"" : ""FAILED"";
      return res.status(202).json({
        error: ""server_action_workflow_recorded"",
        code: ""SERVER_ACTION_WORKFLOW_RECORDED"",
        action: ""RESTART_SERVICES"",
        outcome,
        workflowId: workflow.workflowId,
        executionId: workflow.executionId,
        operationId: workflow.operationId,
        workflowStatus: workflow.workflowStatus,
        phaseStatus: workflow.phaseStatus,
        serviceControl: workflow.serviceControl,
        message: workflow.message,
        statusUrl: `/api/workflows/${workflow.workflowId}`,
        executionsUrl: `/api/workflows/${workflow.workflowId}/executions`,
        retryable: workflow.workflowStatus === ""failed"",
      });
    } catch (error) {
      req.log?.error?.({ error }, ""failed to record internal restart workflow"");
      return res.status(500).json({
        error: ""server_action_workflow_failed"",
        code: ""SERVER_ACTION_WORKFLOW_FAILED"",
        action: ""RESTART_SERVICES"",
        outcome: ""FAILED"",
        serviceControl: ""NOT_PERFORMED"",
        message: ""The internal EngineeringOS restart workflow could not be recorded."",
        retryable: true,
      });
    }
  }

  const { startedAt: now, assistantAt: msgNow } = allocateTurnTimestamps();

  // Keep execution handoff fail-closed in the streaming route too. This check
  // happens before provider resolution and before SSE headers are committed.
  if (
    !sessionId &&
    isImmediateExecutionRequest(message) &&
    (
      !rawTurnIntent.classification.implementationPlanMode
      || isRepairPlanExecutionRequest(message)
    )
  ) {
    return res.status(409).json({
      error: ""execution_session_required"",
      message: ""Repair Plan execution requires the original audit session."",
    });
  }
  if (isPlanExecutionRequest(message) && !buildPlanMessageId) {
    return res.status(409).json({
      error: ""approved_plan_handoff_required"",
      code: ""PLAN_APPROVAL_REQUIRED"",
      message: ""Approve an implementation plan and start Build Mode before executing it."",
    });
  }
  if (effectiveExecutionId && !sessionId) {
    return res.status(400).json({
      error: ""executionId requires the original chat session"",
      code: ""EXECUTION_SESSION_REQUIRED"",
    });
  }

  const rlChat = await checkProjectRateLimitDb(projectId);
  if (!rlChat.allowed) {
    return res.status(429).json({
      error: `LLM rate limit exceeded — max ${LLM_RATE_LIMIT} calls per minute per project. Retry in ${rlChat.retryAfterSec}s.`,
    });
  }

  const { validRootPath, fallbackUsed: rootFallbackUsed, originalPath: rootOriginalPath } =
    await resolveRootPath(project.rootPath, projectId);

  let approvedImplementationPlan: ApprovedImplementationPlan | undefined;
  let approvedImplementationExecutionPlan: ActiveTaskExecutionPlan | undefined;
  let implementationPlanScope: Set<string> | undefined;
  let modelMessage = message;
  // Decide this from the validated user text before any Build handoff
  // augmentation. A greeting must never inherit Build Mode state, even when
  // the client retries with stale buildPlanMessageId metadata.
  let greetingTurnForExecution = isolatedConversationTurn;
  const effectiveBuildPlanMessageId = isolatedConversationTurn ? undefined : buildPlanMessageId;
  if (effectiveBuildPlanMessageId) {
    if (!sessionId) {
      return res.status(400).json({
        error: ""Build handoff requires the original chat session"",
        code: ""BUILD_SESSION_REQUIRED"",
      });
    }
    if (!validRootPath) {
      return res.status(409).json({
        error: ""The project root is unavailable for Build Mode"",
        code: ""BUILD_ROOT_UNAVAILABLE"",
      });
    }

    const [planRow] = await db
      .select({
        message: aiChatMessagesTable,
        session: aiChatSessionsTable,
      })
      .from(aiChatMessagesTable)
      .innerJoin(
        aiChatSessionsTable,
        eq(aiChatMessagesTable.sessionId, aiChatSessionsTable.id),
      )
      .where(eq(aiChatMessagesTable.id, effectiveBuildPlanMessageId))
      .limit(1);

    if (!planRow) {
      return res.status(404).json({ error: ""Implementation plan not found"", code: ""PLAN_NOT_FOUND"" });
    }
    if (planRow.session.projectId !== projectId) {
      return res.status(403).json({ error: ""Implementation plan does not belong to this project"" });
    }
    if (planRow.session.id !== sessionId) {
      return res.status(409).json({
        error: ""Build Mode must use the session that produced the approved plan"",
        code: ""BUILD_SESSION_MISMATCH"",
      });
    }

    const storedPlan = parseTaskResult(planRow.message.taskResult);
    if (!storedPlan || storedPlan.kind !== ""IMPLEMENTATION_PLAN_RESULT"") {
      return res.status(400).json({ error: ""The selected message is not an implementation plan"", code: ""PLAN_INVALID"" });
    }
    if (storedPlan.approvalStatus !== ""APPROVED"" || storedPlan.writeAccess !== ""APPROVED_FOR_BUILD"") {
      return res.status(409).json({
        error: ""Approve the implementation plan before starting Build Mode"",
        code: ""PLAN_APPROVAL_REQUIRED"",
        approvalStatus: storedPlan.approvalStatus,
      });
    }
    approvedImplementationPlan = storedPlan;
    implementationPlanScope = getImplementationPlanScope(storedPlan, validRootPath);
    if (implementationPlanScope.size === 0) {
      return res.status(409).json({
        error: ""This implementation plan has no safe file scope and cannot enter Build Mode"",
        code: ""PLAN_FILE_SCOPE_REQUIRED"",
      });
    }
    // Plans created before the context-manifest contract remain valid when
    // their approved file scope is present; newer plans are checked against
    // the immutable scan context before execution.
    if (storedPlan.contextManifest) {
      const contextFailure = await validatePlanContextForExecution(
        storedPlan,
        projectId,
        validRootPath,
      );
      if (contextFailure) {
        logger.warn({ projectId, code: contextFailure.code }, ""Build handoff context blocked"");
        return res.status(409).json(contextFailure);
      }
    }
    const browserProfileFailure = await validateBrowserProfileForDelivery(
      projectId,
      project.updatedAt.toISOString(),
      storedPlan.browserValidationProfile,
    );
    if (browserProfileFailure) return res.status(409).json(browserProfileFailure);
    approvedImplementationExecutionPlan = buildActiveTaskExecutionPlan({
      implementationPlan: storedPlan,
      objective,
      projectId,
      rootPath: validRootPath,
    }) ?? undefined;
    if (
      !approvedImplementationExecutionPlan ||
      approvedImplementationExecutionPlan.readiness !== ""READY"" ||
      approvedImplementationExecutionPlan.nodes.length === 0
    ) {
      logger.warn({
        projectId,
        readiness: approvedImplementationExecutionPlan?.readiness,
        nodeCount: approvedImplementationExecutionPlan?.nodes.length,
      }, ""Build handoff plan blocked"");
      return res.status(409).json({
        error: ""This implementation plan is not executable by the server-owned Build coordinator"",
        code: ""PLAN_BUILD_BLOCKED"",
        readiness: approvedImplementationExecutionPlan?.readiness ?? ""BLOCKED"",
      });
    }
    await db.insert(eventsTable).values({
      id: randomUUID(),
      type: ""AiBuildStarted"",
      projectId,
      severity: ""info"",
      message: ""Build Mode started from the approved implementation plan"",
      correlationId: effectiveBuildPlanMessageId,
      payload: { messageId: effectiveBuildPlanMessageId, approvedFiles: [...implementationPlanScope] },
    });
    modelMessage = [
      message,
      """",
      ""BUILD HANDOFF — execute only the approved implementation plan below."",
      `Objective: ${storedPlan.objective}`,
      `Approved files: ${[...implementationPlanScope].join("", "") || ""(none)""}`,
      ""Use the existing read and deferred-write flow. Prepare pending changes only; do not claim that files were applied, committed, or published."",
      ""Do not read, write, or propose changes for files outside the approved file list."",
      `Approved plan JSON: ${JSON.stringify(storedPlan)}`,
    ].join(""\n"");
  }

  let existingSession: (typeof aiChatSessionsTable.$inferSelect) | undefined;
  if (sessionId) {
    const [found] = await db
      .select()
      .from(aiChatSessionsTable)
      .where(eq(aiChatSessionsTable.id, sessionId))
      .limit(1);
    if (found && found.projectId !== projectId) {
      return res.status(403).json({ error: ""Session does not belong to this project"" });
    }
    if (!found) {
      return res.status(404).json({ error: ""Chat session not found"", code: ""SESSION_NOT_FOUND"" });
    }
    existingSession = found;
  }

  const persistedActiveTaskState = resolveSessionTaskState(
    existingSession?.activeTaskState,
    projectId,
  );
  const continuationCandidate = isTaskContinuationRequest(message)
    || isProjectQueryContinuationCandidate(message);
  const recoveredActiveTaskState = !persistedActiveTaskState && continuationCandidate
    ? await recoverSessionTaskStateFromExecution({
        sessionId: existingSession?.id,
        projectId,
        rootPath: validRootPath,
      })
    : null;
  const streamResumableStateCandidate = persistedActiveTaskState ?? recoveredActiveTaskState;
  const resumesSessionState =
    isTaskContinuationRequest(message, streamResumableStateCandidate)
    || Boolean(effectiveExecutionId)
    || Boolean(effectiveBuildPlanMessageId);
  // A fresh project query remains tool-capable, but must not inherit the
  // previous turn's target or evidence requirements.
  isolatedConversationTurn =
    rawTurnIntent.kind === ""CHAT""
    && !rawTurnIntent.serverAction
    && !resumesSessionState;
  greetingTurnForExecution = isolatedConversationTurn;
  const streamResumableStateForTurn = resumesSessionState
    ? streamResumableStateCandidate
    : null;
  const streamClassificationResolution = resumeActiveTaskClassification(
    message,
    rawTurnClassification,
    streamResumableStateForTurn,
  );
  const streamImplementationPlanResume = isImplementationPlanContinuation(
    message,
    streamResumableStateForTurn,
  );
  const streamClassification = streamClassificationResolution.classification;
  const streamTurnIntent = resolveTurnIntent(message, {
    classification: streamClassification,
    resumed: streamClassificationResolution.resumed,
    implementationPlanResume: streamImplementationPlanResume,
    buildHandoff: Boolean(approvedImplementationPlan && effectiveBuildPlanMessageId),
    projectOrientation: streamResumableStateForTurn?.projectOrientation === true,
  });
  const projectOrientationTurn =
    streamTurnIntent.kind === ""PROJECT_QUERY""
    && (
      isProjectOrientationQuestion(message)
      || streamResumableStateForTurn?.projectOrientation === true
    );
  let projectOrientationExecution = projectOrientationTurn;
  logger.info({
    scope: ""chat-route"",
    action: ""continuation_decision"",
    stream: true,
    persistedStateLoaded: Boolean(persistedActiveTaskState),
    recoveryAttempted: !persistedActiveTaskState && continuationCandidate,
    recoveredStateLoaded: Boolean(recoveredActiveTaskState),
    continuationCandidate,
    stateContinuationMatched: Boolean(
      streamResumableStateCandidate
      && isTaskContinuationRequest(message, streamResumableStateCandidate),
    ),
    resumed: streamClassificationResolution.resumed,
    rawTaskType: rawTurnClassification.taskType,
    rawCategory: rawTurnClassification.category,
    resolvedTurnIntent: streamTurnIntent.kind,
    projectTargetId: streamTurnIntent.projectTarget?.id ?? null,
  }, ""chat/stream: continuation decision"");
  const capabilityProbeTurn =
    isCapabilityProbeRequest(message) || Boolean(streamResumableStateForTurn?.capabilityProbe);
  const streamActiveEvidenceContract = resolveActiveEvidenceContract({
    explicitObjective: objective,
    projectQueryTarget: streamTurnIntent.projectTarget,
    capabilityProbeTurn,
    message,
  });
  const streamObjective = streamActiveEvidenceContract.objective;
  const streamProjectQuery = streamActiveEvidenceContract.projectQuery;
  const capabilityProbeContract = isCapabilityProbeRequest(message)
    ? {
        sourceFiles: [...CAPABILITY_PROBE_SOURCE_FILES],
        requiredClaims: [...CAPABILITY_PROBE_CLAIM_IDS],
        outputContract: streamTurnIntent.outputContract,
      }
    : streamResumableStateForTurn?.capabilityProbe
      ? {
          sourceFiles: [...streamResumableStateForTurn.capabilityProbe.sourceFiles],
          requiredClaims: [...streamResumableStateForTurn.capabilityProbe.requiredClaims],
          outputContract: streamResumableStateForTurn.capabilityProbe.outputContract,
        }
      : undefined;
  // Keep this compatible with consumers that still resolve the pre-scope
  // TurnIntent declaration while the workspace packages are being rebuilt.
  const streamAuditScopeDescription = (streamTurnIntent as unknown as {
    auditScopeDescription?: string;
  }).auditScopeDescription;
  const streamModelHasTools = streamTurnIntent.requiresTools;
  const streamExecutionPlan = resolveChatExecutionPlan(streamTurnIntent, streamModelHasTools, message);
  let analysisCorrelation: {
    operationId: string;
    projectId: string;
    sessionId?: string;
    projectRevision: string;
    rootAvailable: boolean;
    evidenceProvenance: string;
  } = {
    operationId: randomUUID(),
    projectId,
    ...(sessionQualityAudit && sessionId ? { sessionId } : {}),
    projectRevision: project.updatedAt.toISOString(),
    rootAvailable: Boolean(validRootPath),
    evidenceProvenance: ""project-analysis"",
  };
  const analysisToolRunner = streamModelHasTools
    ? createProjectAnalysisToolRunner(projectId, validRootPath ?? project.rootPath ?? """")
    : undefined;
  if (streamModelHasTools && !validRootPath) {
    return res.status(409).json({
      error: ""project_root_unavailable"",
      code: ""TOOL_ANALYSIS_ROOT_UNAVAILABLE"",
      failureCategory: ""root_unavailable"",
      outcome: ""FAILED"",
      message: ""The project analysis root is unavailable; no completed analysis was produced."",
      retryable: true,
    });
  }

  // Provider/model routing must use the same authoritative intent as the
  // downstream agent. In particular, a terse continuation can inherit a
  // persisted forensic task and must not be routed from its raw text alone.
  // Server-owned actions must not require an AI provider. In particular,
  // ""run scan"" is a real project mutation handled by the scan queue below,
  // not a prompt that a provider may answer narratively.
  const providerResolved = streamTurnIntent.serverAction === ""RUN_PROJECT_SCAN""
    ? null
    : await requireProvider(req.userId, res, {
        requireTools: streamModelHasTools,
        qualityProfile: streamTurnIntent.executionTaskType,
      });
  if (streamTurnIntent.serverAction !== ""RUN_PROJECT_SCAN"" && !providerResolved) return;
  // Read-only project and forensic turns may safely overlap. The apply lock is
  // reserved for an approved Build handoff, where the model can produce a
  // scoped write proposal and the existing write/approval gates apply.
  const requiresApplySerialization = isWriteCapableTurn(streamTurnIntent);
  const applyLock = requiresApplySerialization
    ? await tryAdvisoryLock(LockNamespace.APPLY, projectId)
    : { acquired: true, release: async () => undefined };
  if (!applyLock.acquired) {
    return res.status(409).json({
      error: ""apply_in_progress"",
      hint: ""File changes are still being written for this project — wait a moment, then retry."",
    });
  }

  let executionWorkerId: string | undefined;
  let aiExecution: Awaited<ReturnType<typeof getAiExecutionForUser>>;
  let executionAbortController: AbortController | undefined;
  let executionHeartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let executionLeaseLost = false;
  let sseHeartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let sseConnectionClosed = false;
  let executionTerminal = false;
  let terminalAssistantMessageId: string | undefined;
  let completedTerminalProjection: AiTerminalProjection | undefined;
  let completedExecutionProjection: AiExecutionProjection | undefined;
  let executionNodeStates: ActiveTaskExecutionPlan[""nodes""] = [];
  let resumeCheckpoint: AiExecutionCheckpoint | undefined;
  let autonomousOperation: ReturnType<typeof createAutonomousOperationContract> | undefined;
  let settleExecutionCheckpoint: () => Promise<void> = async () => undefined;
  const providerAttemptSummary: NonNullable<AiExecutionCheckpoint[""providerAttempts""]> = [];
  const rememberProviderAttempt = (attempt: {
    provider: string;
    outcome: ""success"" | ""failure"" | ""cancelled"";
    providerFailureKind?: string | null;
  }) => {
    if (attempt.outcome !== ""failure"" || !attempt.providerFailureKind) return;
    providerAttemptSummary.push({
      provider: attempt.provider,
      code: attempt.providerFailureKind,
    });
    if (providerAttemptSummary.length > 8) providerAttemptSummary.shift();
  };
  const retainedEvidence = new Map<string, string>();
  const retainedReadStatuses = new Map<string, ReadStatus>();
  const traceSteps: AgentStep[] = [];
  let sourceEvidenceRequiredForTurn =
    streamTurnIntent.requiresEvidence || projectOrientationExecution;
  const evidenceReadsForTerminal = () => collectRetainedEvidenceReads(
    retainedEvidence,
    sourceEvidenceRequiredForTurn,
    retainedReadStatuses,
    traceSteps,
  );
  const evidenceProgressForTerminal = () => deriveEvidenceProgressCheckpoint({
    objective: streamObjective,
    traceSteps,
    retainedEvidence,
    operationId: aiExecution?.operationId ?? analysisCorrelation.operationId,
    sourceRevision: analysisCorrelation.projectRevision,
  });
  const evidenceFailureSummary = () => summarizeEvidenceForFailure(
    traceSteps,
    retainedEvidence,
    retainedReadStatuses,
  );
  const terminalEvidenceStateForRun = () => terminalEvidenceState(
    evidenceFailureSummary(),
    evidenceProgressForTerminal(),
  );

  try {
    res.setHeader(""Content-Type"", ""text/event-stream"");
    res.setHeader(""Cache-Control"", ""no-cache, no-transform"");
    res.setHeader(""Connection"", ""keep-alive"");
    res.setHeader(""X-Accel-Buffering"", ""no"");
    res.flushHeaders();

    // Keep the proxy/browser connection alive while provider or tool work is
    // quiet. This is separate from the durable execution heartbeat below:
    // the latter protects worker ownership, while this comment frame protects
    // the client's ability to observe the eventual terminal result.
    sseHeartbeatTimer = setInterval(() => {
      if (sseConnectionClosed || res.writableEnded || res.destroyed) return;
      try {
        res.write("": heartbeat\n\n"");
      } catch {
        sseConnectionClosed = true;
      }
    }, 15_000);

    res.once(""close"", () => {
      sseConnectionClosed = true;
      if (sseHeartbeatTimer) {
        clearInterval(sseHeartbeatTimer);
        sseHeartbeatTimer = undefined;
      }
    });

    function sse(data: Record<string, unknown>): void {
      if (sseConnectionClosed || res.writableEnded || res.destroyed) return;
      res.write(serializeAiSseEvent(data));
    }

    // AI-TASK-003 & 009: Resolve the effective linked task.
    // Priority: (1) explicit linkedTaskId in request, (2) stored in existing session.
    const effectiveLinkedTaskId = linkedTaskId ?? existingSession?.linkedTaskId ?? undefined;
    let activeTask: { id: string; title: string; description: string | null; priority: string; relatedFiles: string[] } | undefined;
    if (effectiveLinkedTaskId) {
      const [foundTask] = await db
        .select()
        .from(tasksTable)
        .where(eq(tasksTable.id, effectiveLinkedTaskId))
        .limit(1);
      if (!foundTask) {
        sse({ type: ""error"", code: ""TASK_NOT_FOUND"", message: ""Task not found"" });
        res.end();
        return;
      }
      // AI-TASK-009: Ownership guard — task must belong to the same project.
      if (foundTask.projectId !== projectId) {
        sse({ type: ""error"", code: ""INVALID_TASK_CONTEXT"", message: ""Invalid task context — task does not belong to this project"" });
        res.end();
        return;
      }
      activeTask = {
        id: foundTask.id,
        title: foundTask.title,
        description: foundTask.description ?? null,
        priority: foundTask.priority,
        relatedFiles: foundTask.relatedFiles,
      };
    }

    const sessionIdToUse = existingSession?.id ?? randomUUID();

    // Reserve a new session before the long model/tool loop starts. The client
    // needs a stable identity even if the model is slow, the tab is refreshed,
    // or the stream fails before the final `done` event. The user and assistant
    // messages are still committed together after the model returns.
    if (!existingSession) {
      const [createdSession] = await db
        .insert(aiChatSessionsTable)
        .values({
          id: sessionIdToUse,
          projectId,
          linkedTaskId: effectiveLinkedTaskId ?? null,
          title: (() => {
            const trimmed = message.trim();
            const isGreeting = /^(مرحبا|مرحبً?ا|أهلاً?|سلام|هلا|hi|hello|hey|greetings|سلاماً?|صباح الخير|مساء الخير|good (morning|afternoon|evening))[\s!.،,]*$/i.test(trimmed);
            return (!isGreeting && trimmed.length > 10)
              ? trimmed.slice(0, 60)
              : `Session ${now.toISOString().slice(0, 16).replace(""T"", "" "")}`;
          })(),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      if (!createdSession) {
        sse({ type: ""error"", code: ""SESSION_CREATE_FAILED"", message: ""Failed to create chat session"" });
        res.end();
        return;
      }
      existingSession = createdSession;
      sse({
        type: ""session_started"",
        sessionId: createdSession.id,
        title: createdSession.title,
        updatedAt: createdSession.updatedAt.toISOString(),
      });
    }

    if (streamTurnIntent.serverAction === ""RUN_PROJECT_SCAN"") {
      if (effectiveExecutionId) {
        const existingScanExecution = await getAiExecutionForUser(effectiveExecutionId, req.userId);
        const existingScanRequest = existingScanExecution
          ? parseExecutionRequest(existingScanExecution.request)
          : undefined;
        const existingObjective = existingScanRequest?.objective;
        const existingJobId = existingObjective
          && typeof existingObjective === ""object""
          && !Array.isArray(existingObjective)
          && typeof (existingObjective as Record<string, unknown>).scanJobId === ""string""
          ? (existingObjective as Record<string, unknown>).scanJobId as string
          : existingScanExecution?.operationId;
        if (!existingScanExecution || existingScanRequest?.turnIntent !== ""RUN_PROJECT_SCAN"" || !existingJobId) {
          sse({ type: ""error"", code: ""SCAN_EXECUTION_NOT_FOUND"", message: ""The requested project scan execution was not found."" });
          res.end();
          return;
        }
        const [existingJob] = await db
          .select()
          .from(scanJobsTable)
          .where(eq(scanJobsTable.id, existingJobId))
          .limit(1);
        if (!existingJob) {
          sse({ type: ""error"", code: ""SCAN_JOB_NOT_FOUND"", message: ""The durable project scan job was not found."" });
          res.end();
          return;
        }
        if (existingScanExecution.status === ""running"" || existingScanExecution.status === ""queued"") {
          sse({
            type: ""execution_started"",
            executionId: existingScanExecution.id,
            status: existingScanExecution.status,
            resumable: true,
            turnIntent: ""RUN_PROJECT_SCAN"",
            operationMode: ""CHAT"",
            proofRequired: false,
          });
          sse({
            type: ""error"",
            code: ""SCAN_ALREADY_RUNNING"",
            message: ""This project scan is already running on the server. Follow its durable status instead of starting another scan."",
            executionId: existingScanExecution.id,
            jobId: existingJob.id,
          });
          res.end();
          return;
        }
        if (existingScanExecution.status === ""completed"" || existingScanExecution.status === ""failed""
          || existingJob.status === ""completed"" || existingJob.status === ""failed"") {
          const [existingMessage] = existingScanExecution.finalMessageId
            ? await db
              .select()
              .from(aiChatMessagesTable)
              .where(eq(aiChatMessagesTable.id, existingScanExecution.finalMessageId))
              .limit(1)
            : [];
          if (!existingMessage) {
            sse({ type: ""error"", code: ""SCAN_RESULT_NOT_FOUND"", message: ""The completed scan result was not found."" });
            res.end();
            return;
          }
          const terminalProjection = await loadTerminalProjection({
            executionId: existingScanExecution.id,
            sessionId: sessionIdToUse,
            fallbackMessageId: existingMessage.id,
          });
          sse({
            type: ""execution_started"",
            executionId: existingScanExecution.id,
            status: existingScanExecution.status,
            resumable: false,
            turnIntent: ""RUN_PROJECT_SCAN"",
            operationMode: ""CHAT"",
            proofRequired: false,
          });
          sse({
            type: ""scan_started"",
            projectId,
            jobId: existingJob.id,
            status: existingJob.status,
          });
          sse({
            type: ""scan_completed"",
            projectId,
            jobId: existingJob.id,
            status: existingJob.status,
            result: existingJob.result ?? null,
            error: existingJob.error ? redactUserFacingText(existingJob.error).slice(0, 500) : null,
          });
          sse({
            type: ""done"",
            sessionId: sessionIdToUse,
            executionId: existingScanExecution.id,
            operationId: existingScanExecution.operationId ?? existingJob.id,
            operationMode: ""CHAT"",
            terminalProjection,
            projection: await loadExecutionProjectionById(existingScanExecution.id),
            message: existingMessage,
            sources: [`scan-job:${existingJob.id}`],
            pendingChanges: [],
            telemetry: { resumed: true },
          });
          res.end();
          return;
        }
        sse({ type: ""error"", code: ""SCAN_EXECUTION_NOT_RESUMABLE"", message: ""This project scan is no longer resumable."" });
        res.end();
        return;
      }

      const jobId = randomUUID();
      const queuedAt = new Date();
      const scanRequest: AiExecutionRequestEnvelope = {
        projectId,
        turnIntent: ""RUN_PROJECT_SCAN"",
        operationId: jobId,
        sessionId: sessionIdToUse,
        message,
        modelMessage: message,
        workspaceRevision: project.updatedAt.toISOString(),
        workspaceRoot: validRootPath ?? null,
        objective: { kind: ""RUN_PROJECT_SCAN"", scanJobId: jobId },
        validationTargetPaths: [],
        proofRequired: false,
      };
      executionWorkerId = randomUUID();
      const createdExecution = await createAiExecution({
        userId: req.userId,
        request: scanRequest,
        idempotencyKey: idempotencyKey ?? jobId,
        projectId,
        sessionId: sessionIdToUse,
        linkedTaskId: effectiveLinkedTaskId,
        correlationId: jobId,
        workspaceRoot: validRootPath ?? null,
      });
      aiExecution = createdExecution.execution;
      const claimedExecution = await claimAiExecution({
        executionId: aiExecution.id,
        userId: req.userId,
        workerId: executionWorkerId,
      });
      if (!claimedExecution) {
        sse({ type: ""error"", code: ""EXECUTION_CLAIM_CONFLICT"", message: ""Another request won the scan execution claim."" });
        res.end();
        return;
      }
      aiExecution = claimedExecution;
      const scanExecution = aiExecution;
      await persistPendingUserTurn({
        sessionId: sessionIdToUse,
        executionId: scanExecution.id,
        message,
        turnIntent: ""RUN_PROJECT_SCAN"",
        createdAt: now,
      });
      sse({
        type: ""execution_started"",
        executionId: scanExecution.id,
        status: scanExecution.status,
        ...(createdExecution.resumeToken ? { resumeToken: createdExecution.resumeToken } : {}),
        resumable: true,
        turnIntent: ""RUN_PROJECT_SCAN"",
        operationMode: ""CHAT"",
        proofRequired: false,
      });
      const scanMessageTrace = () => JSON.stringify([{
        kind: ""server_action"",
        action: ""RUN_PROJECT_SCAN"",
        jobId,
        executionId: scanExecution.id,
      }]);

      sse({
        type: ""intent"",
        intent: ""RUN_PROJECT_SCAN"",
        operationMode: ""CHAT"",
        requiresEvidence: false,
      });
      sse({ type: ""stage"", stage: ""queueing-project-scan"" });

      const [queuedJob] = await db.transaction(async (tx) => {
        const [createdJob] = await tx
          .insert(scanJobsTable)
          .values({
            id: jobId,
            projectId,
            status: ""queued"",
            createdAt: queuedAt,
            idempotencyKey: jobId,
          })
          .returning();
        await tx
          .update(projectsTable)
          .set({ status: ""scanning"", updatedAt: queuedAt })
          .where(eq(projectsTable.id, projectId));
        await tx.insert(eventsTable).values({
          id: randomUUID(),
          type: ""ProjectScanQueued"",
          projectId,
          severity: ""info"",
          message: ""Scan queued from AI chat"",
          payload: { jobId, source: ""RUN_PROJECT_SCAN"" },
          correlationId: jobId,
        });
        await tx
          .update(aiChatSessionsTable)
          .set({ updatedAt: sql`GREATEST(${aiChatSessionsTable.updatedAt}, ${msgNow})` })
          .where(eq(aiChatSessionsTable.id, sessionIdToUse));
        return [createdJob];
      });

      if (!queuedJob) {
        sse({ type: ""error"", code: ""SCAN_QUEUE_FAILED"", message: ""The project scan could not be queued."" });
        res.end();
        return;
      }

      let scanCheckpointSequence = scanExecution.checkpointVersion ?? 0;
      const scanOperation = parseAiExecutionCheckpoint(scanExecution.checkpoint)?.operation;
      const checkpointScan = async (
        stage: AiExecutionCheckpoint[""stage""],
        detail: string,
      ): Promise<void> => {
        scanCheckpointSequence += 1;
        const accepted = await checkpointAiExecution({
          executionId: scanExecution.id,
          workerId: executionWorkerId!,
          checkpoint: {
            stage,
            sequence: scanCheckpointSequence,
            ...(scanOperation ? { operation: scanOperation } : {}),
            detail,
            updatedAt: new Date().toISOString(),
          },
        });
        if (!accepted) {
          throw new Error(""Scan execution lease was lost before terminalization."");
        }
      };
      await checkpointScan(""running"", ""Project scan queued and waiting for the scan worker."");

      sse({
        type: ""scan_started"",
        projectId,
        jobId,
        status: queuedJob.status,
      });

      try {
        heavyJobQueue.enqueueWithId(jobId, () => runScanJob(jobId, projectId));
      } catch (error) {
        logger.error({ error, projectId, jobId }, ""chat scan action: failed to enqueue scan"");
        await db
          .update(scanJobsTable)
          .set({ status: ""failed"", error: ""Failed to queue scan job"", finishedAt: new Date() })
          .where(eq(scanJobsTable.id, jobId));
      }

      let lastStatus: string | undefined;
      let completedJob: typeof queuedJob | undefined;
      const deadline = Date.now() + 15 * 60_000;
      let lastExecutionHeartbeatAt = Date.now();
      while (Date.now() < deadline) {
        if (Date.now() - lastExecutionHeartbeatAt >= AI_EXECUTION_HEARTBEAT_INTERVAL_MS) {
          const heartbeatAccepted = await heartbeatAiExecution({
            executionId: scanExecution.id,
            workerId: executionWorkerId!,
          });
          if (!heartbeatAccepted) {
            throw new Error(""Scan execution heartbeat was rejected."");
          }
          lastExecutionHeartbeatAt = Date.now();
        }
        const [currentJob] = await db
          .select()
          .from(scanJobsTable)
          .where(eq(scanJobsTable.id, jobId))
          .limit(1);
        if (!currentJob) break;
        completedJob = currentJob;
        if (currentJob.status !== lastStatus) {
          lastStatus = currentJob.status;
          await checkpointScan(
            currentJob.status === ""completed"" || currentJob.status === ""failed"" ? ""finalizing"" : ""running"",
            `Project scan status: ${currentJob.status}.`,
          );
          sse({
            type: ""scan_progress"",
            projectId,
            jobId,
            status: currentJob.status,
            ...(currentJob.error ? { error: redactUserFacingText(currentJob.error).slice(0, 240) } : {}),
          });
          if (currentJob.status === ""running"") {
            sse({ type: ""stage"", stage: ""running-project-scan"" });
          }
        }
        if (currentJob.status === ""completed"" || currentJob.status === ""failed"") break;
        await new Promise((resolve) => setTimeout(resolve, 500));
      }

      const finalJob = completedJob;
      const scanSucceeded = finalJob?.status === ""completed"";
      const scanError = finalJob?.error
        ? redactUserFacingText(finalJob.error).slice(0, 500)
        : !finalJob
          ? ""The scan job could not be read after it was queued.""
          : ""The project scan did not complete before the server deadline."";
      const result = finalJob?.result;
      const resultSummary = typeof result?.summary === ""string"" ? result.summary : undefined;
      const content = scanSucceeded
        ? [
            ""Project scan completed successfully."",
            resultSummary,
            `Scan job: ${jobId}`,
          ].filter(Boolean).join(""\n\n"")
        : `Project scan failed: ${scanError}\n\nScan job: ${jobId}`;
      const assistantAt = new Date();
      const assistantMessageId = randomUUID();
      await db.transaction(async (tx) => {
        const [msg] = await tx
          .insert(aiChatMessagesTable)
          .values({
            id: assistantMessageId,
            sessionId: sessionIdToUse,
            role: ""assistant"",
            content,
            turnIntent: ""RUN_PROJECT_SCAN"",
            executionId: scanExecution.id,
            outcome: null,
            errorCode: null,
            errorMessage: null,
            sources: JSON.stringify([`scan-job:${jobId}`]),
            toolTrace: scanMessageTrace(),
            createdAt: assistantAt,
          })
          .returning({ id: aiChatMessagesTable.id });
        await tx
          .update(aiChatSessionsTable)
          .set({ updatedAt: sql`GREATEST(${aiChatSessionsTable.updatedAt}, ${assistantAt})` })
          .where(eq(aiChatSessionsTable.id, sessionIdToUse));
        return msg;
      });

      if (!executionWorkerId) {
        throw new Error(""Scan execution worker was not initialized."");
      }
      const terminalAccepted = scanSucceeded
        ? await completeAiExecution({
            executionId: scanExecution.id,
            workerId: executionWorkerId,
            finalMessageId: assistantMessageId,
            finalMessageContent: content,
            operationId: jobId,
            workspaceRoot: validRootPath ?? null,
            proofRequired: false,
          })
        : await failAiExecution({
            executionId: scanExecution.id,
            workerId: executionWorkerId,
            finalMessageId: assistantMessageId,
            finalMessageErrorCode: ""PROJECT_SCAN_FAILED"",
            error: scanError,
            resumable: false,
          });
      if (!terminalAccepted) {
        throw new Error(""Scan execution terminalization was rejected."");
      }
      const [assistantMsg] = await db
        .select()
        .from(aiChatMessagesTable)
        .where(eq(aiChatMessagesTable.id, assistantMessageId))
        .limit(1);
      if (!assistantMsg) {
        throw new Error(""Scan assistant message was not persisted."");
      }
      const terminalProjection = await loadTerminalProjection({
        executionId: scanExecution.id,
        sessionId: sessionIdToUse,
        fallbackMessageId: assistantMessageId,
      });
      sse({
        type: ""scan_completed"",
        projectId,
        jobId,
        status: scanSucceeded ? ""completed"" : ""failed"",
        ...(!scanSucceeded ? { error: scanError } : {}),
      });
      sse({
        type: ""done"",
        sessionId: sessionIdToUse,
        message: {
          ...assistantMsg,
          sources: JSON.stringify([`scan-job:${jobId}`]),
          turnIntent: ""RUN_PROJECT_SCAN"",
          outcome: scanSucceeded ? ""SUCCEEDED"" : ""FAILED"",
          executionId: aiExecution.id,
          createdAt: assistantAt.toISOString(),
        },
        sources: [`scan-job:${jobId}`],
        toolTrace: scanMessageTrace(),
        pendingChanges: [],
        executionId: aiExecution.id,
        operationId: jobId,
        operationMode: ""CHAT"",
        terminalProjection,
        projection: await loadExecutionProjectionById(aiExecution.id),
        telemetry: { latencyMs: Date.now() - now.getTime() },
      });
      res.end();
      return;
    }

    if (!providerResolved) {
      throw new Error(""AI provider resolution missing for a non-server action"");
    }
    const { provider, apiKey } = providerResolved;

    if (streamAuditScopeDescription) {
      sse({
        type: ""forensic_status"",
        scopeDescription: streamAuditScopeDescription,
      });
    }

    const immediateExecutionRequest = isImmediateExecutionRequest(message);
    const historyLimit = historyFetchLimitForPlan(streamExecutionPlan);
    const historyRows = existingSession
      ? await db
          .select()
          .from(aiChatMessagesTable)
          .where(eq(aiChatMessagesTable.sessionId, existingSession.id))
          .orderBy(desc(aiChatMessagesTable.createdAt))
          .limit(historyLimit)
      : [];

    // Build the project context before creating the durable execution. The
    // context manifest is the canonical workspace revision for evidence. If
    // execution creation happens first, the request can capture
    // project.updatedAt while the session/checkpoint later capture the
    // filesystem revision from the context manifest.
    sse({ type: ""stage"", stage: ""building-context"" });
    const baseProjectContext = await buildProjectContext(projectId, {
      plan: streamExecutionPlan,
      operationId: analysisCorrelation.operationId,
      ...(validRootPath ? { sourceRoot: validRootPath } : {}),
      intent: {
        kind: streamTurnIntent.kind,
        classification: String(streamTurnIntent.classification),
        operationMode: streamTurnIntent.operationMode,
        phases: streamTurnIntent.phases.map((phase) => String(phase)),
        requiresEvidence: sourceEvidenceRequiredForTurn,
        contextMode: streamTurnIntent.contextMode,
        compoundExecution: streamTurnIntent.compoundExecution,
        compoundWrite: streamTurnIntent.compoundWrite,
      },
    });
    const shouldReusePreviouslyAcceptedEvidence =
      streamTurnIntent.kind === ""PROJECT_QUERY"" || streamTurnIntent.classification.implementationPlanMode;
    const previouslyAcceptedEvidence = shouldReusePreviouslyAcceptedEvidence
      ? collectPreviouslyAcceptedPlanningEvidence(
          historyRows,
          baseProjectContext.workspaceRevision ?? project.updatedAt.toISOString(),
        )
      : [];
    const projectQueryPreviouslyAcceptedEvidence = streamTurnIntent.kind === ""PROJECT_QUERY""
      ? filterAcceptedEvidenceToCurrentManifest(previouslyAcceptedEvidence, baseProjectContext)
      : [];
    const projectContext = streamTurnIntent.classification.implementationPlanMode
      ? await buildPlanningFilesystemContext(
          baseProjectContext,
          validRootPath,
          message,
          previouslyAcceptedEvidence,
        )
      : baseProjectContext;
    analysisCorrelation.projectRevision =
      projectContext.workspaceRevision ?? analysisCorrelation.projectRevision;

    const taskObjectiveProofRequired = Boolean(
      streamTurnIntent.requiresEvidence
      || streamTurnIntent.projectTarget
      || projectOrientationTurn
      || streamObjective
      || effectiveBuildPlanMessageId
      || (effectiveLinkedTaskId && streamTurnIntent.kind === ""DELIVERY"")
      || (implementationPlanScope && implementationPlanScope.size > 0)
      || (
        isImmediateExecutionRequest(message)
        && (
          !streamTurnIntent.classification.implementationPlanMode
          || isRepairPlanExecutionRequest(message)
        )
      ),
    );
    const taskObjective = buildTaskObjectiveContract({
      message,
      projectId,
      workspaceRevision: analysisCorrelation.projectRevision,
      targetPaths: implementationPlanScope ? [...implementationPlanScope] : [],
      proofRequired: taskObjectiveProofRequired,
      turnIntent: streamTurnIntent.kind,
      operationMode: streamTurnIntent.operationMode,
      implementationTaskMode: streamTurnIntent.classification.implementationTaskMode,
    });
    let executionRequest: AiExecutionRequestEnvelope = {
      projectId,
       turnIntent: streamTurnIntent.kind,
      ...(projectOrientationTurn ? { projectOrientation: true } : {}),
      // Session task state is context, not proof that this request is a
      // resume. Fresh executions must receive a new operation identity from
      // createAiExecution; only an explicit execution can carry the old one.
      ...(effectiveExecutionId && streamResumableStateForTurn?.operationId
        ? { operationId: streamResumableStateForTurn.operationId }
        : {}),
      sessionId: sessionIdToUse,
      message,
      modelMessage,
      workspaceRevision: analysisCorrelation.projectRevision,
       workspaceRoot: validRootPath ?? null,
      ...(effectiveLinkedTaskId ? { linkedTaskId: effectiveLinkedTaskId } : {}),
      ...(effectiveBuildPlanMessageId ? { buildPlanMessageId: effectiveBuildPlanMessageId } : {}),
      ...(streamObjective ? { objective: streamObjective } : {}),
      ...(taskObjective ? { taskObjective } : {}),
      validationTargetPaths: implementationPlanScope ? [...implementationPlanScope] : [],
      ...(capabilityProbeContract ? { capabilityProbe: capabilityProbeContract } : {}),
      // Session task linkage is context, not an autonomous execution request.
      // Only an explicit delivery/task execution, Build handoff, declared
      // objective, scoped implementation plan, or direct execution command
      // enters the proof-required contract. Evidence-aware turn intent is also
      // server-owned proof authorization; otherwise a forensic request can be
      // downgraded to ordinary chat merely because it has no explicit objective.
      proofRequired: taskObjectiveProofRequired,
      ...(isResumableTaskType(streamClassification.taskType)
        || capabilityProbeContract
        || streamTurnIntent.projectTarget
        || projectOrientationTurn
        ? {
            resumeContract: {
              taskType: streamClassification.taskType,
              outputContract: streamTurnIntent.outputContract,
              contextProfile: streamClassification.contextProfile,
              sessionId: sessionIdToUse,
              projectRevision: analysisCorrelation.projectRevision,
              requiresEvidence: sourceEvidenceRequiredForTurn,
              ...(capabilityProbeContract ? { capabilityProbe: capabilityProbeContract } : {}),
              scope: {
                projectId,
                rootPath: validRootPath ?? null,
                linkedTaskId: effectiveLinkedTaskId ?? null,
              },
            },
          }
        : {}),
    };
    let orientationManifest: AiOrientationRoleManifest | undefined =
      executionRequest.resumeContract?.orientationManifest;
    let proofRequired = executionRequest.proofRequired === true;
    executionWorkerId = randomUUID();
    let executionResumeToken: string | undefined;
    aiExecution = effectiveExecutionId
      ? await getAiExecutionForUser(effectiveExecutionId, req.userId)
      : undefined;

    if (effectiveExecutionId && !aiExecution) {
      sse({ type: ""error"", code: ""EXECUTION_NOT_FOUND"", message: ""AI execution not found"" });
      res.end();
      return;
    }

    if (aiExecution) {
      const storedRequest = parseExecutionRequest(aiExecution.request);
      const legacyBuildModelBinding = Boolean(
        storedRequest?.buildPlanMessageId
        && storedRequest.modelMessage === storedRequest.message
        && executionRequest.modelMessage.startsWith(
          `${executionRequest.message}\n\nBUILD HANDOFF`,
        ),
      );
      const optionalBindingMatches = (
        storedValue: unknown,
        requestedValue: unknown,
        requested: boolean,
      ): boolean => !requested
        || storedValue === undefined
        || JSON.stringify(storedValue ?? null) === JSON.stringify(requestedValue ?? null);
      const bindingMatches = storedRequest &&
        storedRequest.projectId === executionRequest.projectId &&
        storedRequest.sessionId === executionRequest.sessionId &&
        // Requests persisted before turnIntent became part of the durable
        // contract remain resumable; every newer request must match exactly.
        (storedRequest.turnIntent === undefined ||
          storedRequest.turnIntent === executionRequest.turnIntent) &&
        storedRequest.message === executionRequest.message &&
        (
          storedRequest.modelMessage === executionRequest.modelMessage
          || legacyBuildModelBinding
        ) &&
        optionalBindingMatches(
          storedRequest.linkedTaskId,
          executionRequest.linkedTaskId,
          linkedTaskId !== undefined,
        ) &&
        optionalBindingMatches(
          storedRequest.buildPlanMessageId,
          executionRequest.buildPlanMessageId,
          effectiveBuildPlanMessageId !== undefined,
        ) &&
        optionalBindingMatches(
          storedRequest.validationTargetPaths,
          executionRequest.validationTargetPaths,
          implementationPlanScope !== undefined && implementationPlanScope.size > 0,
        ) &&
        optionalBindingMatches(
          storedRequest.objective,
          executionRequest.objective,
          streamObjective !== undefined,
        );
      const taskObjectiveBindingMatches =
        !executionRequest.taskObjective
        || storedRequest?.taskObjective === undefined
        || JSON.stringify(storedRequest.taskObjective) === JSON.stringify(executionRequest.taskObjective);
      if (!bindingMatches || !taskObjectiveBindingMatches) {
        sse({
          type: ""error"",
          code: ""EXECUTION_BINDING_MISMATCH"",
          message: ""Execution does not match the requested session, plan, or validation scope."",
        });
        res.end();
        return;
      }
      const storedWorkspaceRoot = aiExecution.workspaceRoot ?? null;
      const requestedWorkspaceRoot = validRootPath ?? null;
      const hasPersistedWorkspaceRoot =
        aiExecution.workspaceRoot !== null
        || storedRequest?.workspaceRoot !== undefined;
      const hasPersistedWorkspaceRevision =
        aiExecution.baseRevision !== null
        || storedRequest?.workspaceRevision !== undefined;
      const storedWorkspaceRevision =
        aiExecution.baseRevision
        ?? storedRequest?.workspaceRevision
        ?? null;
      if (
        aiExecution.projectId !== projectId
        || (hasPersistedWorkspaceRoot && storedWorkspaceRoot !== requestedWorkspaceRoot)
        || (
          hasPersistedWorkspaceRevision
          && storedWorkspaceRevision !== (storedRequest?.workspaceRevision ?? analysisCorrelation.projectRevision)
        )
      ) {
        sse({
          type: ""error"",
          code: ""EXECUTION_PROVENANCE_MISMATCH"",
          message: ""Execution provenance no longer matches the project root or revision. Start a new execution."",
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      if (aiExecution.status === ""running"") {
        sse({
          type: ""error"",
          code: ""EXECUTION_ALREADY_RUNNING"",
          message: ""This execution is already running. Reconnect through its status instead of starting a duplicate."",
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      if ([""cancelled"", ""completed"", ""cancelling""].includes(aiExecution.status)) {
        sse({
          type: ""error"",
          code: ""EXECUTION_NOT_RESUMABLE"",
          message: `Execution is already ${aiExecution.status}.`,
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      if (!effectiveResumeToken) {
        sse({
          type: ""error"",
          code: ""EXECUTION_RESUME_TOKEN_REQUIRED"",
          message: ""A resume token is required to continue this execution."",
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      if (
        (!effectiveExecutionId
          && hasStaleTaskStateRevision(
            streamResumableStateForTurn,
            analysisCorrelation.projectRevision,
          ))
        || (effectiveExecutionId
          && hasStaleTaskStateRevision(
            streamResumableStateForTurn,
            storedRequest?.workspaceRevision ?? analysisCorrelation.projectRevision,
          ))
      ) {
        sse({
          type: ""error"",
          code: ""RESUME_REVISION_STALE"",
          message: ""The saved analysis belongs to an older project revision. Start a new scoped analysis."",
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      // The original request owns the analysis revision. A reconnect must not
      // silently move the same operation onto a newer workspace revision.
      if (storedRequest?.workspaceRevision) {
        analysisCorrelation.projectRevision = storedRequest.workspaceRevision;
      }
      // A resume is governed by the immutable request that created the
      // execution. The retry message cannot downgrade or upgrade its proof
      // contract by omitting Build/objective metadata.
      // Older executions predate the explicit proofRequired field. Recover
      // their proof contract only from stored execution metadata; never from
      // the retry message or from a session's ambient task linkage.
      proofRequired = storedRequest?.proofRequired ?? Boolean(
        storedRequest?.buildPlanMessageId
        || storedRequest?.objective
        || storedRequest.validationTargetPaths.length > 0
        || isImmediateExecutionRequest(storedRequest.message),
      );
      executionRequest = {
        ...storedRequest,
        modelMessage: storedRequest.modelMessage,
      };
      projectOrientationExecution =
        projectOrientationTurn || executionRequest.projectOrientation === true;
      sourceEvidenceRequiredForTurn =
        streamTurnIntent.requiresEvidence || projectOrientationExecution;
      modelMessage = storedRequest.modelMessage;
      resumeCheckpoint = parseAiExecutionCheckpoint(aiExecution.checkpoint);
      orientationManifest =
        executionRequest.resumeContract?.orientationManifest
        ?? resumeCheckpoint?.orientationManifest;
      if (orientationManifest && !executionRequest.resumeContract?.orientationManifest) {
        executionRequest = {
          ...executionRequest,
          resumeContract: executionRequest.resumeContract
            ? { ...executionRequest.resumeContract, orientationManifest }
            : executionRequest.resumeContract,
        };
      }
      const resumeContext = buildAiExecutionResumeContext(resumeCheckpoint);
      if (resumeContext) {
        modelMessage = `${modelMessage}\n\n${resumeContext}`;
      }
      const previousAttempt = aiExecution.attempt;
      if (sourceEvidenceRequiredForTurn) {
        const reusableEvidence = await loadReusableEvidenceReads({
          executionId: aiExecution.id,
          projectId,
          attempt: previousAttempt,
          operationId: aiExecution.operationId,
          sourceRevision: storedRequest.workspaceRevision,
        });
        for (const read of reusableEvidence) {
          retainedEvidence.set(read.path, read.body);
        }
      }
      const claimed = await claimAiExecution({
        executionId: aiExecution.id,
        userId: req.userId,
        workerId: executionWorkerId,
        resumeToken: effectiveResumeToken,
      });
      if (!claimed) {
        sse({
          type: ""error"",
          code: ""EXECUTION_CLAIM_CONFLICT"",
          message: ""Another resume won the execution claim. Retry after refreshing its status."",
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      aiExecution = claimed;
      analysisCorrelation.operationId = aiExecution.operationId ?? aiExecution.id;
    } else {
      const created = await createAiExecution({
        userId: req.userId,
        request: executionRequest,
        idempotencyKey: idempotencyKey ?? randomUUID(),
        projectId,
        sessionId: sessionIdToUse,
        linkedTaskId: effectiveLinkedTaskId,
        buildPlanMessageId: effectiveBuildPlanMessageId,
        correlationId: analysisCorrelation.operationId ?? sessionIdToUse,
        workspaceRoot: validRootPath ?? null,
      });
      aiExecution = created.execution;
      analysisCorrelation.operationId = aiExecution.operationId ?? aiExecution.id;
      executionResumeToken = created.resumeToken;
      const claimed = await claimAiExecution({
        executionId: aiExecution.id,
        userId: req.userId,
        workerId: executionWorkerId,
      });
      if (!claimed) {
        sse({
          type: ""error"",
          code: ""EXECUTION_CLAIM_CONFLICT"",
          message: ""Another request won the execution claim. Retry after refreshing its status."",
          executionId: aiExecution.id,
        });
        res.end();
        return;
      }
      aiExecution = claimed;
      analysisCorrelation.operationId = aiExecution.operationId ?? aiExecution.id;
    }

    const providerHistoryPolicy = resolveProviderHistoryPolicy({
      turnIntent: streamTurnIntent,
      message,
      immediateExecutionRequest,
      buildHandoff: Boolean(
        streamTurnIntent.allowsBuildHandoff
        && approvedImplementationPlan
        && effectiveBuildPlanMessageId,
      ),
      currentTurn: {
        executionId: aiExecution.id,
      },
    });

    await persistPendingUserTurn({
      sessionId: sessionIdToUse,
      executionId: aiExecution.id,
      message,
      turnIntent: streamTurnIntent.kind,
      createdAt: now,
    });

    const resumableTaskStateAtStart = nextSessionTaskState({
      persisted: streamResumableStateForTurn,
      classification: streamClassification,
      effectiveTurnKind: streamTurnIntent.kind,
      resumed: streamClassificationResolution.resumed || Boolean(aiExecution && effectiveExecutionId),
      projectId,
      rootPath: validRootPath,
      linkedTaskId: effectiveLinkedTaskId,
      revision: analysisCorrelation.projectRevision,
      capabilityProbe: Boolean(executionRequest.capabilityProbe),
      projectQuery: streamProjectQuery,
      projectQueryObjective: streamObjective,
      projectOrientation: projectOrientationExecution,
      forcePersist: streamTurnIntent.kind === ""FORENSIC_AUDIT"",
      operationId: aiExecution.operationId ?? executionRequest.operationId,
      executionId: aiExecution.id,
      now: msgNow,
      readFiles: [],
      executionPlan: null,
    });
    await db.update(aiChatSessionsTable)
      .set({
        activeTaskState: resumableTaskStateAtStart,
        updatedAt: sql`GREATEST(${aiChatSessionsTable.updatedAt}, ${msgNow})`,
      })
      .where(and(
        eq(aiChatSessionsTable.id, sessionIdToUse),
        sessionTaskStateIsAtOrBefore(msgNow),
      ));

    let checkpointSequence = aiExecution.checkpointVersion;
    const streamCheckpoint = parseAiExecutionCheckpoint(aiExecution.checkpoint);
    let checkpointFailure: unknown;
    const resumableStateForExecution = greetingTurnForExecution ? null : persistedActiveTaskState;
    const executionPlanForRun = !greetingTurnForExecution && approvedImplementationPlan
      ? approvedImplementationExecutionPlan
        ?? buildActiveTaskExecutionPlan({
            implementationPlan: approvedImplementationPlan,
           objective: streamObjective,
            projectId,
            rootPath: validRootPath,
          })
      : resumableStateForExecution?.executionPlan ?? null;
    const persistedExecutionNodes = executionPlanForRun?.nodes ?? [];
    const reconciledExecutionNodes = reconcileExecutionNodeCheckpoint(
      persistedExecutionNodes,
      resumeCheckpoint?.nodeStates,
    );
    if (resumeCheckpoint?.nodeStates && !reconciledExecutionNodes) {
      await failAiExecution({
        executionId: aiExecution.id,
        workerId: executionWorkerId!,
        error: ""Execution node checkpoint does not match the server-owned plan."",
        cancelled: false,
      });
      executionTerminal = true;
      const executionProjection = await loadExecutionProjectionById(aiExecution.id);
      sse({
        type: ""error"",
        code: ""EXECUTION_NODE_CHECKPOINT_MISMATCH"",
        message: ""The saved execution progress does not match the approved plan. Start a fresh execution."",
        executionId: aiExecution.id,
        projection: executionProjection,
      });
      res.end();
      return;
    }
    executionNodeStates = reconciledExecutionNodes ?? persistedExecutionNodes;
    const checkpointOperation = resumeCheckpoint?.operation;
     autonomousOperation = streamTurnIntent.kind === ""CHAT""
       ? undefined
       : checkpointOperation ?? createAutonomousOperationContract({
           operationId: aiExecution.operationId ?? aiExecution.id,
            taskObjective: executionRequest.taskObjective,
           objective: executionRequest.objective
             ? JSON.stringify(executionRequest.objective)
             : executionRequest.message,
           revisionManifest: executionRequest.workspaceRevision,
           targetPaths: executionRequest.validationTargetPaths,
           expectedBehavior: executionRequest.message,
           nodes: executionNodeStates.map((node) => ({
             id: node.id,
             kind: executionRequest.validationTargetPaths.length > 0 ? ""mutate"" : ""inspect"",
             dependencies: [...node.dependencies],
             status: node.status,
             attempts: node.attempts,
             validationAttempts: node.validationAttempts,
             allowedFiles: [...node.allowedFiles],
             validationProfile: node.validationProfile,
             evidenceRefs: [],
           })),
         });
    const activeExecutionAbortController = new AbortController();
    executionAbortController = activeExecutionAbortController;
    registerAiExecutionController(aiExecution.id, activeExecutionAbortController);
    // Cancellation can win the race between execution creation and controller
    // registration. Re-check the durable row after registration so a provider
    // turn cannot wait forever on an already-cancelled execution.
    const executionStateAfterRegistration = await getAiExecutionForUser(aiExecution.id, req.userId);
    if (
      aiExecution.status === ""cancelling""
      || aiExecution.cancelRequestedAt
      || executionStateAfterRegistration?.status === ""cancelling""
      || executionStateAfterRegistration?.cancelRequestedAt
    ) {
      activeExecutionAbortController.abort(new Error(""AI execution cancellation requested""));
    }
    executionHeartbeatTimer = setInterval(() => {
      if (executionTerminal || activeExecutionAbortController.signal.aborted) return;
      void heartbeatAiExecution({
        executionId: aiExecution!.id,
        workerId: executionWorkerId!,
      }).then((renewed) => {
        if (!renewed && !executionTerminal && !activeExecutionAbortController.signal.aborted) {
          executionLeaseLost = true;
          logger.warn(
            { executionId: aiExecution!.id },
```",2026-09-19T21:01:34.550Z
a325b18e-b204-4707-8b70-82b1306b6a96,8e78c54c-23e5-445e-85ec-6e3816154184,lib/ai-orchestrator/src/agents/chat-agent.ts,source,8134,8996,25ac2893084dde2bc525486fc311b95d36344bb76133f203a777f96c237bdb84,37704,1,0,"File: lib/ai-orchestrator/src/agents/chat-agent.ts
```
        // ObjectiveContract allows callers to omit goal; the tool-loop
        // contract needs a concrete value for its durable objective state.
        goal: objective.goal ?? message,
        requiredEvidencePaths: objective.requiredEvidencePaths,
        requiredClaims: objective.requiredClaims.map((claim) => ({
          claimId: claim.claimId,
          text: claim.text,
          requiredEvidencePaths: claim.requiredEvidencePaths,
          ...(claim.evidenceNeedles ? { evidenceNeedles: claim.evidenceNeedles } : {}),
          ...(claim.evidenceNeedlesByPath
            ? { evidenceNeedlesByPath: claim.evidenceNeedlesByPath }
            : {}),
        })),
      }
    : undefined;
  const completeCapabilityProbeEvidence =
    capabilityProbeRequest && hasCompleteCapabilityProbeEvidence(prefetchFileContents);
  const completeActiveObjectiveManifest =
    !loopObjective
    || objectiveEvidenceManifestCompleteForPaths(loopObjective, prefetchFileContents.keys());
  let loopResult = await executeToolLoop({
    messages,
    strategy,
    model,
    powerModel,
    provider: providerId,
    apiKey,
    capability: modelDecision.capability,
    tools,
    toolManifest,
    rootPath: rootPath ?? """",
    pendingChanges,
    initialFileContents: prefetchFileContents,
    // Truncated prefetch bodies are locator input only. The tool loop uses
    // objective evidence needles to choose a bounded read_file_range window;
    // the targeted result, not this map, becomes accepted evidence.
    objectiveEvidenceSources: prefetchTraceContents,
    initialReadStatuses: prefetchReadStatuses,
    retainedReadStatuses: prefetchReadStatuses,
    evidenceRecoveryPaths,
    retainedFileContents: retainedEvidence,
    cache: toolCallCache,
    toolChoice:
      capabilityProbeRequest
        ? ""required""
        : immediateIntent && priorRepairPlan && executionFilePaths.length > 0
        ? ""required""
        : undefined,
    maxIterations: budget.maxIterations,
    taskType: executionPlan.taskProfile.taskType,
    requiresEvidence: sourceEvidenceRequired,
    deterministicTaskExecution,
    maxToolCalls: structuredOutputMode || capabilityProbeRequest
      ? Math.max(0, budget.maxToolCalls - prefetchFileContents.size)
      : budget.maxToolCalls,
    toolCallsDisabledAfter:
      completeCapabilityProbeEvidence && completeActiveObjectiveManifest
        ? 0
        : structuredOutputMode || capabilityProbeRequest
          ? Math.max(0, budget.maxIterations - STRUCTURED_OUTPUT_SYNTHESIS_TURNS)
          : undefined,
    // The tool loop may reach its synthesis window after prefetch has already
    // supplied the source bodies. Capability Probe uses the same JSON claim
    // envelope as its recovery path so Gemini cannot spend its output budget on
    // an ambiguous plain-text wrapper before evidence validation runs.
    responseFormat:
      structuredOutputMode || capabilityProbeRequest
        ? { type: ""json_object"" }
        : undefined,
    completeReads: completeReadEvidence,
    executionMode: repairPlanExecution
      ? ""repair_plan""
      : structuredOutputMode || capabilityProbeRequest
        ? ""forensic""
        : undefined,
    assertExecutionOwned,
    compoundWriteMode: deferredWriteProposal,
    executionTargetPaths: repairPlanExecution ? executionFilePaths : undefined,
    // A forensic request can be classified as single-file-shaped before a
    // usable file path is actually extracted (for example, when the user names
    // a directory such as `lib/knowledge-engine/`). An empty allow-list would
    // block every read, including already-prefetched evidence, and leave the
    // model looping on READ_PATH_POLICY_BLOCKED. Apply the isolated manifest
    // only when it contains at least one concrete file.
    allowedToolNames:
      capabilityProbeRequest
        ? completeCapabilityProbeEvidence && completeActiveObjectiveManifest
          ? []
          : [""read_file"", ""read_file_range""]
        : singleFileForensicMode && singleFilePaths.length > 0
          ? [""read_file""]
          : undefined,
    allowedReadPaths:
      singleFileForensicMode && singleFilePaths.length > 0
        ? singleFilePaths
        : turnIntent.projectTarget
          ? [...turnIntent.projectTarget.primaryPaths]
          : undefined,
    // Preserve the server-owned objective manifest at the tool-loop boundary.
    // The scope policy alone can reject unrelated paths, but the ordered
    // evidence cursor and forced recovery require the complete objective.
    objective: loopObjective,
    objectiveScopePolicy: objective?.scopePolicy,
    firstEvidenceTargetPath: loopEvidenceTargetPath ?? undefined,
    orderedForensicRoots: orderedForensicRoots.length > 0 ? orderedForensicRoots : undefined,
    allowTestSources: includeTestSources,
    allowExecutionTools: allowValidationTools,
    approvalState: effectiveApprovalState,
    approvedFilePaths: effectiveApprovedFilePaths,
    validationRunner,
    browserValidationRunner,
    browserValidationContext,
    approvedValidationProfiles,
    commandProfiles,
    commandRunner,
    commandContext,
    analysisToolRunner,
     analysisCorrelation,
    validationTargetPaths,
    signal,
    // Dependency-First traversal (FEG-005/006): once the explicit primary
    // evidence target has been read, any further read of a new dependency file
    // must carry proof of why it is required. Enable the gate whenever traversal
    // is PRIMARY_FIRST so post-first-read traversal cannot fan out into
    // unjustified read chains.
    requireDependencyProof: firstEvidence.traversalPolicy === ""PRIMARY_FIRST"",
    executionLedger,
    onStep: relayAgentStep,
  });
  if (
    capabilityProbeRequest &&
    ""sourceRetrieval"" in loopResult &&
    loopResult.sourceRetrieval?.synthesisTimedOut
  ) {
    relayAgentStep({
      kind: ""diagnostic"",
      code: ""CAPABILITY_PROBE_SYNTHESIS_TIMEOUT"",
      details: [
        ""initial capability-report synthesis exhausted its server-owned deadline"",
        ""retained source evidence was handed to bounded recovery"",
      ],
    });
  }
  // Cancellation is an incomplete forensic run even when some source reads
  // already landed. Keep the evidence for the six-section report, but never
  // allow a cancellation to reach a completed NO_FINDING fallback.
  const cancelledForensicAudit = (): boolean =>
    signal?.aborted === true || loopResult.kind === ""cancelled"";

  // Merge prefetch sources with the engine's ground-truth sources.
  // Prefetch sources are prepended since they were resolved first.
  const toolSources = [...prefetchSources, ...loopResult.toolSources];
  // A targeted project-query synthesis is a server-owned replacement for the
  // provider's candidate response. Keep it separate from loopResult because
  // the response parser is created later in this function. Without this
  // handoff, the deterministic synthesis can be stored in loopResult and then
  // silently discarded when the later acceptance path reads the original
  // provider result.
  let projectQueryEvidenceResponseOverride: string | undefined;
  // Keep both prefetch and in-loop read bodies available to the forensic gate.
  // The loop may read files that were not part of the initial plan.
  //
  // Normalize every body to its RAW source-aligned form at this single merge
  // choke point. Prefetch and tool-loop reads both pass through
  // executeFileTool(""read_file""), which wraps the body with a 2-line
  // `File: <path>\n```\n` header — leaving that wrapper in place shifts every
  // computeSourceSpan line by +2 off the true source file. stripReadFileWrapper
  // removes it when present and leaves already-raw bodies (single-file pre-read)
  // untouched, so spans match the analyst-facing source lines in every path.
  // forensicFileContents is declared at the top of chat() so every terminal
  // finalization path can route its candidate through the Objective Gate.
  // Populate it here from prefetch + tool-loop reads.
  for (const [filePath, content] of incompletePrefetchContents) {
    forensicFileContents.set(filePath, stripReadFileWrapper(content));
  }
  for (const [filePath, content] of prefetchFileContents) {
    forensicFileContents.set(filePath, stripReadFileWrapper(content));
  }
  for (const [filePath, content] of loopResult.fileContents ?? []) {
    forensicFileContents.set(filePath, stripReadFileWrapper(content));
  }

  // Targeted PROJECT_QUERY objectives have a stronger recovery contract than
  // ordinary chat: once the server-owned manifest is complete, a provider
  // empty/partial result must not restart source collection. Give the provider
  // one bounded no-tools synthesis pass over retained evidence, then use the
  // same server-owned claim materialization as the deterministic fallback.
  const isTargetedProjectQueryObjective =
    objective?.objectiveType.startsWith(""PROJECT_QUERY_"") === true;
  // Deterministic synthesis may only promote a contract that already declares
  // behavioral assertions. A symbol-only objective must remain fail-closed:
  // source needles can materialize evidence, but they cannot authorize the
  // server to invent a behavioral explanation from function names alone.
  const hasBehavioralProjectQueryContract =
    isTargetedProjectQueryObjective &&
    (objective?.requiredClaims.length ?? 0) > 0 &&
    objective!.requiredClaims.every((claim) => claim.text.trim().split(/\s+/u).length >= 5);
  // Gap analysis keeps its older symbol-backed project-query contract. Unlike
  // embedded-AI, it does not require a prose behavioral-flow assertion before
  // the retained-read synthesis fallback can run. Keep this exception explicit
  // so arbitrary symbol-only objectives remain fail-closed.
  const isGapAnalysisProjectQueryObjective =
    objective?.objectiveType === ""PROJECT_QUERY_GAP-ANALYSIS"";
  const canSynthesizeProjectQuery =
    hasBehavioralProjectQueryContract || isGapAnalysisProjectQueryObjective;
  const projectQueryManifestComplete =
    isTargetedProjectQueryObjective &&
    objectiveManifestIsComplete(objective, forensicFileContents);
  const materializedProjectQueryEvidence =
    projectQueryManifestComplete
      ? materializeObjectiveClaimEvidence({
          objective,
          fileContents: forensicFileContents,
          sourceWindows: loopResult.evidenceWindows,
        })
      : [];
  if (isTargetedProjectQueryObjective) {
    const materializedClaimIds = new Set(
      materializedProjectQueryEvidence.map((item) => item.claimId),
    );
    const missingClaimIds = objective.requiredClaims
      .map((claim) => claim.claimId)
      .filter((claimId) => !materializedClaimIds.has(claimId));
    relayAgentStep({
      kind: ""diagnostic"",
      code: ""PROJECT_QUERY_CLAIM_MATERIALIZATION"",
      details: [
        `manifestComplete=${projectQueryManifestComplete ? ""true"" : ""false""}`,
        `requiredClaims=${objective.requiredClaims.length}`,
        `materializedClaims=${materializedProjectQueryEvidence.length}`,
        ...(missingClaimIds.length > 0
          ? [`missingClaims=${missingClaimIds.slice(0, 8).join("","")}`]
          : [""missingClaims=none""]),
      ],
    });
  }
  if (
    isTargetedProjectQueryObjective &&
    materializedProjectQueryEvidence.length === objective.requiredClaims.length
  ) {
    const initialCandidate =
      loopResult.kind === ""response"" || loopResult.kind === ""partial""
        ? parseAgentResponse(loopResult.result.content ?? """", ChatResponseSchema, fallbackChatOutput)
        : null;
    const initialText = initialCandidate?.ok
      ? initialCandidate.data.response
      : loopResult.kind === ""response"" || loopResult.kind === ""partial""
        ? normalizeRecoveryAssistantText(loopResult.result.content ?? """")
        : """";
    let recoveredText = initialText;
    const deterministicProjectQueryResponse =
      canSynthesizeProjectQuery
        ? buildProjectQueryEvidenceSynthesis(
            objective,
            materializedProjectQueryEvidence,
            responseLanguage,
          )
        : """";
    if (
      canSynthesizeProjectQuery &&
      (
        !objectiveClaimsAreMentioned(objective, recoveredText)
        || !projectQueryAnswerHasBehavioralFlow(objective, recoveredText)
      )
    ) {
      recoveryAttemptsUsed += 1;
      const evidenceContext = materializedProjectQueryEvidence
        .map((item) => `Claim ${item.claimId} (${item.source}):\n${item.excerpt}`)
        .join(""\n\n"");
      try {
        const recovery = await strategy.call(
          [
            {
              role: ""system"",
              content:
                ""Synthesize a scoped project answer from the retained evidence below. "" +
              ""Do not call tools or request more files. State every server-owned behavioral claim "" +
              ""assertion verbatim, then explain the execution sequence in the requested language. "" +
              ""Do not replace a behavioral explanation with a symbol inventory."",
            },
            {
              role: ""user"",
              content: `${message}\n\nServer-owned retained evidence:\n${evidenceContext}`,
            },
          ],
          {
            model: providerId === ""openrouter"" ? undefined : (modelDecision.model || model),
            maxTokens: 2400,
            timeoutMs: 30_000,
            retryTransient: false,
            maxFallbackModels: 1,
            circuitFailurePolicy: ""suppress"",
            apiKey,
            signal,
            executionLedger,
          },
        );
        const recoveredCandidate = parseAgentResponse(
          recovery.content ?? """",
          ChatResponseSchema,
          fallbackChatOutput,
        );
        recoveredText = recoveredCandidate.ok
          ? recoveredCandidate.data.response
          : normalizeRecoveryAssistantText(recovery.content ?? """");
        relayAgentStep({
          kind: ""diagnostic"",
          code: ""PROJECT_QUERY_NO_TOOLS_SYNTHESIS"",
          details: [
            `retained ${materializedProjectQueryEvidence.length} server-owned claim evidence windows`,
            objectiveClaimsAreMentioned(objective, recoveredText)
              ? ""provider synthesis mentioned every required claim""
              : ""provider synthesis was incomplete; deterministic claim assembly was used"",
          ],
        });
      } catch (error) {
        recoveredText = """";
        const providerOutcome =
          error &&
          typeof error === ""object"" &&
          ""code"" in error &&
          typeof (error as { code?: unknown }).code === ""string""
            ? (error as { code: string }).code
            : ""PROVIDER_FAILURE"";
        relayAgentStep({
          kind: ""diagnostic"",
          code: ""PROJECT_QUERY_NO_TOOLS_SYNTHESIS"",
          details: [
            ""provider synthesis failed; deterministic claim assembly was used"",
            `provider outcome:${providerOutcome.slice(0, 48)}`,
          ],
        });
      }
    }
    if (
      canSynthesizeProjectQuery &&
      (
        !objectiveClaimsAreMentioned(objective, recoveredText)
        || !projectQueryAnswerHasBehavioralFlow(objective, recoveredText)
      )
    ) {
      recoveredText = deterministicProjectQueryResponse;
    }
    // Once every server-owned behavioral claim has a materialized source
    // window, the final candidate must be deterministic and response-bound.
    // Provider prose remains useful for telemetry and recovery decisions, but
    // it cannot be the text later consumed by closeObjectiveClaimsFromEvidence.
    if (
      canSynthesizeProjectQuery &&
      materializedProjectQueryEvidence.length === objective.requiredClaims.length
    ) {
      recoveredText = deterministicProjectQueryResponse;
    }
    projectQueryEvidenceResponseOverride = recoveredText;
    const priorLoopResult = loopResult;
    loopResult = {
      kind: ""response"",
      result: {
        ...(priorLoopResult.kind === ""response"" || priorLoopResult.kind === ""partial""
          ? priorLoopResult.result
          : {}),
        content: JSON.stringify({
          response: recoveredText,
          sources: materializedProjectQueryEvidence.map((item) => item.source),
        }),
        toolCalls: [],
        model:
          priorLoopResult.kind === ""response"" || priorLoopResult.kind === ""partial""
            ? priorLoopResult.result.model
            : modelDecision.model || model,
        usage: { promptTokens: 0, completionTokens: 0 },
      },
      toolSources: priorLoopResult.toolSources,
      fileContents: priorLoopResult.fileContents,
      evidenceWindows: priorLoopResult.evidenceWindows,
      sourceRetrieval: ""sourceRetrieval"" in priorLoopResult
        ? priorLoopResult.sourceRetrieval
        : undefined,
      objectiveState: ""objectiveState"" in priorLoopResult
        ? priorLoopResult.objectiveState
        : undefined,
    };
  }

  // ── Explicit file-scope forensic coverage ──────────────────────────────────
  // For file-scoped mode, ordered-root coverage is not relevant; instead we
  // compute a file-scoped ForensicSourceCoverage that is COMPLETE only when
  // every explicitly named target file was fully read (no truncation markers).
  // This keeps file-scope coverage separate from whole-project reachability
  // and ensures the forensic gate is fail-closed on truncation or read failure.
  if (singleFileForensicMode && singleFilePaths.length > 0) {
    const scopedRoots = singleFilePaths.map((targetPath) => {
      const readContent = forensicFileContents.get(targetPath);
      const wasRead = readContent !== undefined;
      const isTruncated =
        wasRead &&
        hasDisplayTruncationMarker(readContent);
      const coverageComplete = wasRead && !isTruncated;
      return {
        targetPath,
        wasRead,
        isTruncated,
        coverageComplete,
      };
    });
    const coverageComplete = scopedRoots.every((root) => root.coverageComplete);
    const failedRoot = scopedRoots.find((root) => !root.coverageComplete);
    forensicSourceCoverage = {
      complete: coverageComplete,
      requestedFiles: [...singleFilePaths],
      roots: scopedRoots.map((root) => ({
          root: root.targetPath,
          discoveredFiles: 1,
          readFiles: root.wasRead ? 1 : 0,
          unreadFiles: root.wasRead ? 0 : 1,
          status: root.coverageComplete
            ? ""COMPLETE""
            : root.wasRead
              ? ""PARTIAL""
              : ""BUDGET_EXHAUSTED"",
          unreadPaths: root.wasRead ? [] : [root.targetPath],
          truncatedPaths: root.isTruncated ? [root.targetPath] : [],
        })),
      ...(!coverageComplete
        ? {
            reason: failedRoot?.isTruncated
              ? `Scoped forensic read was truncated: ${failedRoot.targetPath}`
              : `Scoped forensic target was not read: ${failedRoot?.targetPath ?? ""unknown""}`,
          }
        : {}),
    };
  }

  // A provider fallback can be text-only after the primary provider completed
  // a read. Preserve the retained evidence, but use the same six-section
  // report and typed result as every other incomplete forensic terminal.
  //
  // A proof-complete project query is different: its deterministic response
  // and closed claims must continue through the response-binding and objective
  // acceptance stages below. Returning the generic retained-evidence response
  // here would discard that server-owned proof and turn a complete objective
  // into OBJECTIVE_BLOCKED.
  const projectQueryHasCompleteEvidenceOverride =
    objective?.objectiveType === ""PROJECT_QUERY_EMBEDDED-AI""
    && projectQueryEvidenceResponseOverride !== undefined
    && objective?.requiredClaims.length !== undefined
    && objective.requiredClaims.length > 0
    && materializedProjectQueryEvidence.length === objective.requiredClaims.length;
  const projectQueryEvidenceReferences = toProjectQueryEvidenceReferences(
    materializedProjectQueryEvidence,
  );
  const hasProjectQueryAcceptanceProjection =
    projectQueryHasCompleteEvidenceOverride
    && objective !== undefined
    && projectQueryEvidenceResponseOverride !== undefined
    && validateResponseLanguage(projectQueryEvidenceResponseOverride, responseLanguage).valid
    && projectQueryAnswerHasBehavioralFlow(objective, projectQueryEvidenceResponseOverride);
  if (
    retainedEvidence
    && retainedEvidence.size > 0
    && !modelHasTools
    && turnIntent.requiresEvidence
    && !projectQueryHasCompleteEvidenceOverride
  ) {
    const retainedEvidenceReport = collectForensicEvidence(
      messages,
      toolSources,
      forensicFileContents,
      includeTestSources,
      forensicScope,
      forensicSourceCoverage,
      requireCompleteReadEvidence,
      queryPlan?.compoundParts,
      undefined,
      responseLanguage,
    );
    const retainedResponse = turnIntent.kind === ""PROJECT_QUERY""
      ? buildProjectQueryIncompleteResponse(message, forensicFileContents, responseLanguage)
      : buildIncompleteForensicReport(retainedEvidenceReport, {
          language: responseLanguage,
          reason: ""PROVIDER_SYNTHESIS_UNAVAILABLE"",
          nextAction: ""Retry or narrow the question to a specific file or function; retained reads will be reused."",
        });
    const retainedTaskResult = buildTaskResult({
      forensicTaskType,
      finalResponse: retainedResponse,
      mergedSources: [...forensicFileContents.keys()],
      semanticBehaviorAnswer: undefined,
      structuredRepairPlan: undefined,
      acceptedBehaviorEvidence: [],
    });
    onDelta?.(retainedResponse);
    return {
      response: retainedResponse,
      sources: [...forensicFileContents.keys()],
      pendingChanges: getExecutionPendingChanges(),
      resolvedModel:
        loopResult.kind === ""response"" || loopResult.kind === ""partial""
          ? loopResult.result.model
            ? { id: loopResult.result.model, provider: providerId, free: providerId === ""openrouter"" }
            : undefined
          : undefined,
      ...(retainedTaskResult ? { taskResult: retainedTaskResult } : {}),
    };
  }

  if (repairPlanExecution && getExecutionPendingChanges().length === 0) {
    recordExecutionDiagnostic(""EXECUTION_NO_EDIT_TOOL"", [
      ""no edit tool was called before execution stopped"",
    ]);
  }

  // ── Deterministic task-execution degradation ───────────────────────────────
  // Task execution must never ask the model to repair malformed JSON or
  // synthesize after a soft limit. The loop telemetry and server-owned pending
  // changes are enough to produce an honest partial report.
  const malformedTaskResponse =
    deterministicTaskExecution && loopResult.kind === ""response"" && loopResult.result.content?.trim()
      ? parseAgentResponse(loopResult.result.content, ChatResponseSchema, fallbackChatOutput)
      : null;
  const taskExecutionPartialReason: TaskExecutionPartialReason | null =
    !deterministicTaskExecution
      ? null
      : loopResult.kind === ""partial"" && loopResult.reason === ""provider_timeout""
        ? ""PROVIDER_TIMEOUT""
        : loopResult.kind === ""partial"" && loopResult.reason === ""soft_limit""
          ? ""SOFT_LIMIT""
          : loopResult.kind === ""partial"" && loopResult.reason === ""empty_response""
            ? ""PROVIDER_TIMEOUT""
          : malformedTaskResponse && !malformedTaskResponse.ok && malformedTaskResponse.code === ""MALFORMED_JSON""
            ? ""MALFORMED_JSON""
            : null;

  if (taskExecutionPartialReason !== null) {
    if (taskExecutionPartialReason === ""MALFORMED_JSON"") {
      // This return path intentionally bypasses the normal parse-error
      // decorator, so annotate the scorecard before returning the
      // deterministic partial report.
      recordBehavioralFailure(
        loopResult.kind === ""response"" || loopResult.kind === ""partial""
          ? loopResult.result.model || model
          : model,
        ""malformed_json"",
      );
    }
    const partialReport = buildTaskExecutionPartialReport({
      reason: taskExecutionPartialReason,
      isArabic: /[\u0600-\u06FF]/.test(message),
      taskChecklist,
      telemetry: taskTelemetry,
      toolSources,
      fileContents: forensicFileContents,
      pendingChangesCount: getExecutionPendingChanges().length,
    });
    relayAgentStep({
      kind: ""diagnostic"",
      code: ""EXECUTION_DETERMINISTIC_PARTIAL_REPORT"",
      details: [
        `trigger: ${taskExecutionPartialReason}`,
        ""report built from completed tool telemetry without a model recovery call"",
      ],
    });
    // AI-OBJ-005/007: this deterministic degradation path is a terminal
    // finalization seam. Route it through the shared Objective Completion Gate
    // so a BLOCKED objective replaces the partial report and only the gated text
    // (if streaming) is emitted — never a claim that the objective completed.
    const partialReportFinalized = finalizeObjectiveAndStream({
      objective,
      fileContents: forensicFileContents,
      objectiveEvidenceSources: prefetchTraceContents,
      message,
      response: partialReport,
      provenEdges: objectiveRuntimeProvenEdges,
      relayAgentStep,
      streamCallback,
    });
    const gatedPartialReport = partialReportFinalized.gatedResponse;
    // AI-008: build typed result for deterministic partial-report path.
    const partialReportTaskResult = buildTaskResult({
      forensicTaskType,
      finalResponse: gatedPartialReport,
      mergedSources: toolSources,
      semanticBehaviorAnswer: undefined,
      structuredRepairPlan: undefined,
      acceptedBehaviorEvidence: [],
    });
    return {
      response: gatedPartialReport,
      sources: toolSources,
      pendingChanges: getExecutionPendingChanges(),
      resolvedModel:
        loopResult.kind === ""response"" || loopResult.kind === ""partial""
          ? loopResult.result.model
            ? { id: loopResult.result.model, provider: providerId, free: providerId === ""openrouter"" }
            : undefined
          : undefined,
      ...(partialReportTaskResult ? { taskResult: partialReportTaskResult } : {}),
    };
  }

  // ── Deterministic execution guard ────────────────────────────────────────
  // A repeated cached read is not a successful execution. Keep this outcome
  // separate from ordinary budget exhaustion so the user sees the real cause.
  if (loopResult.kind === ""stopped"") {
    const stoppedResponse = repairPlanExecution
      ? finalizeTaskResponse(
          buildRepairPlanExecutionResponse(
            getExecutionPendingChanges(),
            /[\u0600-\u06FF]/.test(message),
            true,
            loopResult.reason,
            loopResult.tool,
            executionDiagnosticDetails,
          ),
        )
      : finalizeTaskResponse(""The tool loop stopped after repeated identical tool calls."");
    // AI-OBJ-005/007: terminal degradation seam — route through the shared
    // Objective Completion Gate so a BLOCKED objective never lets the stopped
    // loop's partial text read as a completed answer.
    const stoppedFinalized = finalizeObjectiveAndStream({
      objective,
      fileContents: forensicFileContents,
      objectiveEvidenceSources: prefetchTraceContents,
      message,
      response: stoppedResponse,
      provenEdges: objectiveRuntimeProvenEdges,
      relayAgentStep,
    });
    const gatedStoppedResponse = stoppedFinalized.gatedResponse;
    if (isForensicOrEvidenceRun && !isTargetedProjectQueryObjective) {
      relayForensicTerminal({
        onStep,
        loopResult,
        fileContents: forensicFileContents,
        claimsUnclosedButEvidenceAvailable: false,
        report: gatedStoppedResponse,
      });
    }
    // AI-008: build typed result for stopped-loop degradation path.
    const stoppedTaskResult = buildTaskResult({
      forensicTaskType,
      finalResponse: gatedStoppedResponse,
      mergedSources: toolSources,
      semanticBehaviorAnswer: undefined,
      structuredRepairPlan: undefined,
      acceptedBehaviorEvidence: [],
    });
    return {
      response: gatedStoppedResponse,
      sources: toolSources,
      pendingChanges: getExecutionPendingChanges(),
      ...(stoppedTaskResult ? { taskResult: stoppedTaskResult } : {}),
    };
  }

  if (repairPlanExecution && loopResult.kind === ""partial"") {
    const repairPartialResponse = finalizeTaskResponse(
      buildRepairPlanExecutionResponse(
        getExecutionPendingChanges(),
        /[\u0600-\u06FF]/.test(message),
        true,
        loopResult.reason ?? ""soft_limit"",
        undefined,
        executionDiagnosticDetails,
      ),
    );
    // AI-OBJ-005/007: terminal degradation seam — gate before returning so an
    // unanswered objective is surfaced as BLOCKED, not as a partial ""done"".
    const repairPartialFinalized = finalizeObjectiveAndStream({
      objective,
      fileContents: forensicFileContents,
      objectiveEvidenceSources: prefetchTraceContents,
      message,
      response: repairPartialResponse,
      provenEdges: objectiveRuntimeProvenEdges,
      relayAgentStep,
    });
    const gatedRepairPartialResponse = repairPartialFinalized.gatedResponse;
    // AI-008: build typed result for repair partial degradation path.
    const repairPartialTaskResult = buildTaskResult({
      forensicTaskType,
      finalResponse: gatedRepairPartialResponse,
      mergedSources: toolSources,
      semanticBehaviorAnswer: undefined,
      structuredRepairPlan: undefined,
      acceptedBehaviorEvidence: [],
    });
    return {
      response: gatedRepairPartialResponse,
      sources: toolSources,
      pendingChanges: getExecutionPendingChanges(),
      ...(repairPartialTaskResult ? { taskResult: repairPartialTaskResult } : {}),
    };
  }

  // ── Exhausted with no text at all ────────────────────────────────────────
  // kind:""partial"" falls through to the normal result-processing path below —
  // the model produced at least one text response (triggered by the soft-limit
  // synthesis hint) that we can surface as a useful answer.
  // Only the true kind:""exhausted"" (zero text produced) gets the error message.
  if (loopResult.kind === ""exhausted"") {
    // Bilingual exhaustion message: detect Arabic by checking if the original
    // user message contains Arabic characters (Unicode block U+0600–U+06FF).
    const isArabic = /[\u0600-\u06FF]/.test(message);
    const exhaustionMessage =
      loopResult.reason === ""empty_response""
        ? isArabic
          ? ""لم يُرجع مزوّد الذكاء الاصطناعي استجابة نهائية نصية بعد القراءات المتاحة، لذلك لم يتم إنتاج تقرير. حاول مرة أخرى أو ضيّق نطاق السؤال.""
          : ""The AI provider returned no final text after the available reads, so no report was produced. Try again or narrow the question.""
        : isArabic
          ? ""وصلت إلى الحد الأقصى من خطوات التحليل ولم أتمكن من إنتاج إجابة كاملة. حاول طرح سؤال أكثر تحديداً.""
          : ""The analysis budget was exhausted before I could produce a complete answer. Try a more specific question."";
    const finalExhaustionResponse = structuredOutputMode
      ? applyForensicOutputContract(
          """",
          collectForensicEvidence(
            messages,
            toolSources,
            forensicFileContents,
            includeTestSources,
            forensicScope,
            forensicSourceCoverage,
            requireCompleteReadEvidence,
            queryPlan?.compoundParts,
            undefined,
            responseLanguage,
          ),
          { responseLanguage },
        ).response
      : isForensicOrEvidenceRun && forensicFileContents.size > 0
        ? buildBehaviorEvidenceIncompleteResponse(
            message,
            forensicFileContents,
            responseLanguage,
          )
        : exhaustionMessage;
    const exhaustionFinalResponse = repairPlanExecution
      ? finalizeTaskResponse(
          buildRepairPlanExecutionResponse(
            getExecutionPendingChanges(),
            /[\u0600-\u06FF]/.test(message),
            true,
            loopResult.reason,
            undefined,
            executionDiagnosticDetails,
          ),
        )
      : finalizeTaskResponse(finalExhaustionResponse);
    // AI-OBJ-005/007: terminal exhaustion seam — gate before returning so an
    // unanswered objective reads as BLOCKED, never as a bare ""budget exhausted""
    // answer that could be mistaken for completion.
    const exhaustionFinalized = finalizeObjectiveAndStream({
      objective,
      fileContents: forensicFileContents,
      objectiveEvidenceSources: prefetchTraceContents,
      message,
      response: exhaustionFinalResponse,
      provenEdges: objectiveRuntimeProvenEdges,
      relayAgentStep,
    });
    const gatedExhaustionResponse = exhaustionFinalized.gatedResponse;
    if (isForensicOrEvidenceRun && !isTargetedProjectQueryObjective) {
      relayForensicTerminal({
        onStep,
        loopResult,
        fileContents: forensicFileContents,
        claimsUnclosedButEvidenceAvailable: false,
        report: gatedExhaustionResponse,
      });
    }
    // AI-008: build typed result for exhaustion degradation path.
    const exhaustionTaskResult = buildTaskResult({
      forensicTaskType,
      finalResponse: gatedExhaustionResponse,
      mergedSources: toolSources.length > 0 ? toolSources : [],
      semanticBehaviorAnswer: undefined,
      structuredRepairPlan: undefined,
      acceptedBehaviorEvidence: [],
    });
    return {
      response: gatedExhaustionResponse,
      sources: toolSources.length > 0 ? toolSources : [],
      pendingChanges: getExecutionPendingChanges(),
      ...(exhaustionTaskResult ? { taskResult: exhaustionTaskResult } : {}),
    };
  }

  if (loopResult.kind === ""failed"") {
    const isArabic = /[\u0600-\u06FF]/.test(message);
    const blockedResponse = isArabic
      ? `تم حظر العملية لأن الأداة \`${loopResult.tool}\` لم تكتمل (${loopResult.diagnosticCode}). لم يتم تنفيذ العملية المطلوبة، ولا يمكنني الادعاء بأنها اكتملت.`
      : `The operation is BLOCKED because tool ""${loopResult.tool}"" did not complete (${loopResult.diagnosticCode}). I cannot claim the requested analysis, validation, repair, or change was completed.`;
    return {
      response: finalizeTaskResponse(blockedResponse),
      sources: toolSources,
      pendingChanges: getExecutionPendingChanges(),
    };
  }

  if (loopResult.kind === ""incomplete"") {
    const isArabic = /[\u0600-\u06FF]/.test(message);
    const incompleteResponse = isArabic
      ? `ANALYSIS_INCOMPLETE — لم تكتمل متطلبات الهدف (${loopResult.reason}). تم الاحتفاظ بالأدلة المتاحة، لكن لا يمكنني اعتبار النتيجة مكتملة.`
      : `ANALYSIS_INCOMPLETE — the agent stopped before completing the required objective (${loopResult.reason}). Available evidence was retained, but the result is not complete.`;
    const incompleteFinalized = finalizeObjectiveAndStream({
      objective,
      fileContents: forensicFileContents,
      objectiveEvidenceSources: prefetchTraceContents,
      message,
      response: incompleteResponse,
      provenEdges: objectiveRuntimeProvenEdges,
      relayAgentStep,
      streamCallback,
    });
    const gatedIncompleteResponse = incompleteFinalized.gatedResponse;
    if (isForensicOrEvidenceRun && !isTargetedProjectQueryObjective) {
      relayForensicTerminal({
        onStep,
        loopResult,
        fileContents: forensicFileContents,
        claimsUnclosedButEvidenceAvailable: forensicFileContents.size > 0,
        report: gatedIncompleteResponse,
        objectiveBlocked: incompleteFinalized.blocked,
      });
    }
    const incompleteTaskResult = buildTaskResult({
      forensicTaskType,
      finalResponse: gatedIncompleteResponse,
      mergedSources: toolSources,
      semanticBehaviorAnswer: undefined,
      structuredRepairPlan: undefined,
      acceptedBehaviorEvidence: [],
    });
    return {
      response: finalizeTaskResponse(gatedIncompleteResponse),
      sources: toolSources,
      pendingChanges: getExecutionPendingChanges(),
      ...(incompleteTaskResult ? { taskResult: incompleteTaskResult } : {}),
    };
  }

  // ── Final response from model (kind:""response"" or kind:""partial"") ─────────
  let result = loopResult.kind === ""cancelled""
    ? {
        content: """",
        toolCalls: null,
        model,
        usage: { promptTokens: 0, completionTokens: 0 },
      }
    : loopResult.result;

  // Native providers expose the final synthesis only through SSE. Forensic
  // responses cannot be forwarded from that stream before the contract,
  // recovery, and evidence gates run, so collect it here and feed the same
  // buffered content through the non-streaming finalization path below.
  if (forensicOutputMode && strategy.supportsNativeStream && !cancelledForensicAudit()) {
    let forensicStreamContent = """";
    try {
      const forensicStreamMessages = messages.map((m, i) =>
        i === 0 && m.role === ""system""
          ? {
              ...m,
              content:
```",2026-09-19T21:01:34.550Z
45cc6569-f44d-4cb1-bdc7-c0640f34e694,8e78c54c-23e5-445e-85ec-6e3816154184,lib/ai-orchestrator/src/agents/query-planner.ts,source,,,1031d49f853dd83f7164289d20b2f58e3295f226223deb8f36aec55d6a5b0342,55838,1,0,"File: lib/ai-orchestrator/src/agents/query-planner.ts
```
/**
 * Query Planner
 *
 * A lightweight pre-planning phase (single model call, ≤ 5 s) that runs
 * before the main agentic tool loop.  It analyses the user's message and the
 * project's knowledge-graph summary to produce a structured QueryPlan:
 *
 *   • targetFiles    — files most likely needed (pre-seeded into the cache)
 *   • scopeEstimate  — narrow / medium / broad  (drives iteration budget)
 *   • suggestedIterations — concrete maxIterations hint
 *   • subQueries     — decomposed sub-questions for broad tasks
 *
 * Research basis:
 *   - arXiv:2511.02424 ReAcTree — hierarchical task decomposition before execution
 *   - arXiv:2504.16563 — Global Planning + Hierarchical Execution reduces tool
 *     calls by 40-65 % vs. pure ReAct
 *   - ICML 2025 KG-RAG — graph-guided navigation cuts random exploration by ~70 %
 *
 * Design constraints:
 *   - Hard 5-second timeout: if planning takes too long, FALLBACK_PLAN is
 *     returned and the tool loop starts with sensible defaults.  Planning
 *     must never block the main request.
 *   - No tool calls: the planner uses a single fast-model completion — it
 *     reads only from projectContext.graphSummary, not from the filesystem.
 *   - Graceful degradation: JSON parse failures, model errors, and timeouts
 *     all resolve to FALLBACK_PLAN.
 */

import { db } from ""@workspace/db"";
import {
  findFileEntities,
  searchNodes,
  getNeighborhood,
} from ""@workspace/knowledge-engine"";
import type {
  GraphEntity,
  GraphRelationship,
} from ""@workspace/knowledge-engine"";
import type { ProjectContext } from ""../context-builder.js"";
import type { ProviderStrategy } from ""../provider-strategy.js"";
import type { RawMessage } from ""../groq-client.js"";
import type { ExecutionLedger } from ""../execution-ledger.js"";
import { extractMentionedFiles } from ""./speculative-prefetch.js"";
import {
  buildCrossFileSemanticTrace,
  type CrossFileSemanticTrace,
  type SemanticGraphEdge,
  type SemanticGraphNode,
} from ""../semantic-trace.js"";
import {
  findGapAnalysisMatch,
  normalizeIntentText,
} from ""../task-contracts.js"";
import {
  deriveProjectQueryTargetMode,
  type ProjectQueryTargetMode,
  type ProjectQueryTargetResolution,
} from ""../project-query-target.js"";

// ── Types ─────────────────────────────────────────────────────────────────────

export type ScopeEstimate = ""narrow"" | ""medium"" | ""broad"";
export type QueryPlanStatus = ""valid"" | ""fallback"" | ""invalid"";
export type ProjectOrientationSources = {
  purpose: string[];
  components: string[];
  primaryFlow: string[];
  uncertainty: string[];
};

export type ProjectOrientationRole = keyof ProjectOrientationSources;

/**
 * A project-orientation manifest is durable execution scope, not just a
 * navigation hint. Every role must have at least one non-empty path before it
 * can be persisted or reused as an immutable override.
 */
export function hasCompleteProjectOrientationSources(
  sources: ProjectOrientationSources | undefined,
): sources is ProjectOrientationSources {
  return Boolean(
    sources
    && ORIENTATION_ROLES.every((role) =>
      sources[role].some((file) => typeof file === ""string"" && file.trim().length > 0),
    ),
  );
}

export type CompoundPartKind =
  | ""CURRENT_STATE""
  | ""FEATURES""
  | ""GAPS""
  | ""PRIORITIES""
  | ""OTHER"";

export type CompoundQueryPart = {
  id: string;
  kind: CompoundPartKind;
  question: string;
  requiredCount?: number;
  requiresCitation: boolean;
};

export type QueryPlan = {
  /** The original user intent, retained verbatim for final synthesis. */
  originalIntent: string;
  /** Relevant file paths extracted from the knowledge graph. Max 10. */
  targetFiles: string[];
  /** Entity names from the knowledge graph most relevant to the query. */
  targetEntities: string[];
  /** Estimated breadth of the query — drives iteration budget selection. */
  scopeEstimate: ScopeEstimate;
  /**
   * Concrete maxIterations hint (5–60).
   * narrow → 5-16, medium → 18-35, broad → 40-60.
   */
  suggestedIterations: number;
  /** False only when the planner is confident no filesystem access is needed. */
  requiresToolUse: boolean;
  /** Sub-questions produced for broad queries (empty for narrow/medium). */
  subQueries: string[];
  /** Explicit coverage contract for compound questions. */
  compoundParts: CompoundQueryPart[];
  /** Server-owned interpretation of the planner response. */
  planStatus?: QueryPlanStatus;
  /** Whether the caller has a resolved subsystem target for this plan. */
  targetResolution?: ProjectQueryTargetResolution;
  /** Server-owned explanation of how source targeting was handled. */
  targetMode?: ProjectQueryTargetMode;
  /** Planner confidence that targetFiles are a safe bounded source set. */
  targetConfidence?: number;
  /** Bounded diagnostics for an invalid or fallback plan. */
  planDiagnostics?: string[];
  /**
   * Orientation-only source roles. Each role is a bounded source set that
   * must be completely read before the project explanation can be accepted.
   */
  orientationSources?: ProjectOrientationSources;
  /**
   * PR-011: true when graph enrichment added paths beyond the raw planner
   * response. Used by deriveSourceSelectionRecord to distinguish targeted from
   * graph-enriched plan tiers without comparing targetFiles arrays at call time.
   */
  graphEnriched?: boolean;
};

// ── Constants ─────────────────────────────────────────────────────────────────

const PLANNER_TIMEOUT_MS = 5_000;
const MAX_GRAPH_CHARS = 3_000;
const MAX_TARGET_FILES = 10;
const MAX_SUBQUERIES = 5;
const MAX_ORIENTATION_ROLE_FILES = 2;
/** Hard cap on files added by graph enrichment (task spec: ≤ 15 total). */
const MAX_GRAPH_FILES = 15;
/** Hard timeout for the graph enrichment step (task spec: ≤ 2 seconds). */
const GRAPH_ENRICH_TIMEOUT_MS = 2_000;
const GRAPH_GUIDANCE_TIMEOUT_MS = 2_000;
const MAX_GRAPH_GUIDED_FILES = 10;
const MAX_GRAPH_GUIDED_ROOTS = 4;
const MAX_GRAPH_GUIDED_NEIGHBORS = 6;
const MAX_UNRESOLVED_TARGET_FILES = 4;
const MIN_UNRESOLVED_TARGET_CONFIDENCE = 0.75;
const ORIENTATION_ROLES = [""purpose"", ""components"", ""primaryFlow"", ""uncertainty""] as const;
const GRAPH_PATH_PATTERN =
  /(?:^|[\s""'`([{,])((?:[A-Za-z0-9_.@-]+\/)*[A-Za-z0-9_.@-]+\.(?:md|json|yaml|yml|toml|ts|tsx|js|jsx|mjs|cjs|py|go|rs|sql|css|html))(?=$|[\s""'`)\]},;:])/g;

/**
 * Returned whenever planning fails (timeout, parse error, model error).
 * Keeps the tool loop running with sensible mid-range defaults.
 */
const FALLBACK_PLAN: QueryPlan = {
  originalIntent: """",
  targetFiles: [],
  targetEntities: [],
  scopeEstimate: ""medium"",
    suggestedIterations: 30,
  requiresToolUse: true,
  subQueries: [],
  compoundParts: [],
  planStatus: ""fallback"",
  planDiagnostics: [""planner output was unavailable""],
};

function normalizePlannerPath(value: string): string {
  return value.trim().replace(/\\/g, ""/"").replace(/^(\.\/)+/, """");
}

function graphSummaryPaths(graphSummary: string): string[] {
  const paths = new Set<string>();
  for (const match of graphSummary.matchAll(GRAPH_PATH_PATTERN)) {
    const path = normalizePlannerPath(match[1] ?? """");
    if (path && !path.startsWith(""/"") && !path.split(""/"").includes("".."")) paths.add(path);
  }
  return [...paths];
}

function pickOrientationPaths(
  paths: readonly string[],
  pattern: RegExp,
): string[] {
  return paths.filter((path) => pattern.test(path)).slice(0, MAX_ORIENTATION_ROLE_FILES);
}

/**
 * Build a bounded, navigation-only orientation manifest when the planner
 * provider is unavailable. These paths come from the server-provided graph
 * summary; they are still source evidence only after the read tool succeeds.
 * Empty roles intentionally remain empty so the final coverage gate fails
 * closed instead of inventing a project structure.
 */
export function deriveFallbackOrientationSources(
  graphSummary: string,
  additionalPaths: readonly string[] = [],
): ProjectOrientationSources {
  const paths = [
    ...new Set([
      ...graphSummaryPaths(graphSummary),
      ...additionalPaths
        .map(normalizePlannerPath)
        .filter((path) => path && !path.startsWith(""/"") && !path.split(""/"").includes("".."")),
    ]),
  ];
  return {
    purpose: pickOrientationPaths(
      paths,
      /(?:^|\/)(?:readme(?:\.[^/]+)?|package(?:\.[^/]+)?|pyproject\.toml|cargo\.toml|go\.mod|index\.html|(?:src\/)?(?:main|index)\.(?:ts|tsx|js|jsx|mjs|cjs))$/iu,
    ),
    components: pickOrientationPaths(
      paths,
      /^(?!(?:.*\/(?:__tests__|tests?|specs?)(?:\/|$)|.*\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs)$|(?:.*\/)?(?:route|routes|controller|controllers|handler|handlers|service|services|api|server)(?:\/|\.|$)|(?:.*\/)?[^/]+\.config\.[^/]+$))(?:(?:.*\/)?src\/.*|(?:.*\/)?(?:lib|app|apps|components|ui|client|dashboard|packages?)\/.*)\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs)$|(?:^|\/)assets\/(?:index|main|app)(?:-[^/]*)?\.(?:js|jsx|mjs|cjs|ts|tsx)$/iu,
    ),
    primaryFlow: pickOrientationPaths(
      paths,
      /(?:route|routes|controller|controllers|handler|handlers|service|services|api|server|main|index|(?:spa|404)-redirect).*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs)$/iu,
    ),
    uncertainty: pickOrientationPaths(
      paths,
      /(?:^|\/)(?:__tests__|test|tests|spec|specs|config|configs|deploy|deployment|workflow|workflows|docker|\.github)(?:\/|\.|$)|(?:^|\/).*?\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs)$|(?:package-lock|pnpm-lock|yarn\.lock|tsconfig|vite\.config|replit\.toml|artifact\.toml)|(?:^|\/)(?:404|500|robots|sitemap)(?:\.[^/]+)?$/iu,
    ),
  };
}

function fallbackPlanFor(opts: {
  message: string;
  targetResolution?: ProjectQueryTargetResolution;
  profile: ""default"" | ""project_orientation"";
  graphSummary?: string;
  orientationFallbackPaths?: readonly string[];
  planStatus?: QueryPlanStatus;
  diagnostics?: string[];
}): QueryPlan {
  const orientationSources =
    opts.profile === ""project_orientation""
      ? deriveFallbackOrientationSources(
          opts.graphSummary ?? """",
          opts.orientationFallbackPaths ?? [],
        )
      : undefined;
  const targetFiles = orientationSources
    ? [...new Set(ORIENTATION_ROLES.flatMap((role) => orientationSources[role]))].slice(0, MAX_TARGET_FILES)
    : [];
  return {
    ...FALLBACK_PLAN,
    originalIntent: opts.message,
    targetResolution: opts.targetResolution,
    planStatus: opts.planStatus ?? ""fallback"",
    targetFiles,
    ...(orientationSources ? { orientationSources } : {}),
    planDiagnostics: (opts.diagnostics ?? FALLBACK_PLAN.planDiagnostics ?? []).slice(0, 4),
  };
}

// ── Prompt ────────────────────────────────────────────────────────────────────

function buildPlannerPrompt(
  message: string,
  graphSummary: string,
  targetResolution?: ProjectQueryTargetResolution,
  profile: ""default"" | ""project_orientation"" = ""default"",
): string {
  const truncated =
    graphSummary.length > MAX_GRAPH_CHARS
      ? graphSummary.slice(0, MAX_GRAPH_CHARS) + ""\n…[truncated]""
      : graphSummary;

  return `You are a planning agent for a code intelligence system.
Analyse the user query and return ONLY valid JSON — no markdown, no explanation.

Project knowledge graph (entity names and file paths for context):
${truncated}

User query:
${message}

Return exactly this JSON shape:
{
  ""targetFiles"": [],
  ""targetEntities"": [],
   ""targetConfidence"": 0,
  ""scopeEstimate"": ""narrow"",
  ""suggestedIterations"": 10,
  ""requiresToolUse"": true,
  ""subQueries"": []
  ,""compoundParts"": []
  ${profile === ""project_orientation""
    ? `,""orientationSources"": {
    ""purpose"": [],
    ""components"": [],
    ""primaryFlow"": [],
    ""uncertainty"": []
  }`
    : """"}
}

Rules:
- scopeEstimate ""narrow""  → single concept or file, <5 tool calls needed
- scopeEstimate ""medium""  → multiple related files, 5-15 tool calls
- scopeEstimate ""broad""   → codebase-wide (e.g. ""summarize backlog"", ""review architecture""), 15+ tool calls
- targetFiles: file paths visible in the graph above that are relevant — max ${MAX_TARGET_FILES}, empty if none known
- targetEntities: entity names from the graph — max 10, empty if none relevant
- targetConfidence: a number from 0 to 1 for how confidently targetFiles identify the
  relevant source set; use 0 when the target is ambiguous or the graph is insufficient
- suggestedIterations: integer — narrow 5-16, medium 18-35, broad 40-60
- subQueries: non-empty only when scopeEstimate is ""broad"" — decompose into 2-5 focused sub-questions
- requiresToolUse: false only if the answer is factual and requires no file reading
- compoundParts: preserve every requested part in order. Use kinds CURRENT_STATE, FEATURES, GAPS, PRIORITIES, or OTHER; set requiredCount to 3 only for an explicit top three request; every part requiresCitation when it makes a project claim
- target resolution: ${targetResolution ?? ""not_applicable""}
- when target resolution is unresolved, return targetConfidence >= 0.75 only when the
  targetFiles are a narrow, directly relevant source set; otherwise return 0 and an empty
  targetFiles array. Never treat the knowledge graph as complete evidence.
- ${profile === ""project_orientation""
    ? `orientationSources is required for this orientation request. Select 1-4 existing
  source files for each role:
  - purpose: README, package/app manifest, or the primary application entrypoint
  - components: the main UI, server, domain, or feature composition files
  - primaryFlow: route/controller/handler and service files that show the main user flow
  - uncertainty: tests, configuration, deployment, or boundary files that reveal limits
  Every path must also appear in targetFiles. Keep the union bounded to at most 8 files.
  Do not use graph names or file inventory as evidence without reading the source.`
    : ""orientationSources is omitted unless the project_orientation profile is active.""}
- originalIntent: copy the user query exactly`;
}

// ── JSON parser ───────────────────────────────────────────────────────────────

type RawQueryPlanValidation = {
  valid: boolean;
  diagnostics: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === ""object"" && !Array.isArray(value);
}

/**
 * Validate the planner envelope before normalizing it. Clamping malformed
 * values is unsafe here: a planner that claims a narrow scope with a broad
 * decomposition can bypass the caller's budget and scheduling assumptions.
 */
export function validateQueryPlanShape(
  value: unknown,
  options: { requireOrientationSources?: boolean } = {},
): RawQueryPlanValidation {
  const diagnostics: string[] = [];
  if (!isRecord(value)) return { valid: false, diagnostics: [""plan must be a JSON object""] };

  const scope = value.scopeEstimate;
  if (scope !== ""narrow"" && scope !== ""medium"" && scope !== ""broad"") {
    diagnostics.push(""scopeEstimate must be narrow, medium, or broad"");
  }

  const arrays: Array<[string, number]> = [
    [""targetFiles"", MAX_TARGET_FILES],
    [""targetEntities"", 10],
    [""subQueries"", MAX_SUBQUERIES],
  ];
  for (const [name, max] of arrays) {
    const candidate = value[name];
    if (!Array.isArray(candidate)) {
      diagnostics.push(`${name} must be an array`);
    } else if (candidate.length > max) {
      diagnostics.push(`${name} exceeds the maximum of ${max}`);
    }
  }

  const targetFiles = Array.isArray(value.targetFiles) ? value.targetFiles : [];
  for (const file of targetFiles) {
    if (
      typeof file !== ""string"" ||
      !file.trim() ||
      file.startsWith(""/"") ||
      /^[A-Za-z]:[\\/]/.test(file) ||
      file.split(/[\\/]+/u).includes("".."")
    ) {
      diagnostics.push(""targetFiles contains an invalid project-relative path"");
      break;
    }
  }
  for (const name of [""targetEntities"", ""subQueries""] as const) {
    const values = Array.isArray(value[name]) ? value[name] : [];
    if (values.some((item) => typeof item !== ""string"" || !item.trim())) {
      diagnostics.push(`${name} must contain non-empty strings`);
    }
  }

  const iterations = value.suggestedIterations;
  const range =
    scope === ""narrow"" ? [5, 16] :
      scope === ""broad"" ? [40, 60] : [18, 35];
  if (
    typeof iterations !== ""number"" ||
    !Number.isInteger(iterations) ||
    !Number.isFinite(iterations) ||
    iterations < range[0] ||
    iterations > range[1]
  ) {
    diagnostics.push(`suggestedIterations must be an integer in ${range[0]}-${range[1]}`);
  }
  if (typeof value.requiresToolUse !== ""boolean"") {
    diagnostics.push(""requiresToolUse must be a boolean"");
  }
  if (
    value.targetConfidence !== undefined &&
    (
      typeof value.targetConfidence !== ""number"" ||
      !Number.isFinite(value.targetConfidence) ||
      value.targetConfidence < 0 ||
      value.targetConfidence > 1
    )
  ) {
    diagnostics.push(""targetConfidence must be a number from 0 to 1"");
  }

  if (value.orientationSources !== undefined) {
    if (!isRecord(value.orientationSources)) {
      diagnostics.push(""orientationSources must be an object"");
    } else {
      for (const role of [""purpose"", ""components"", ""primaryFlow"", ""uncertainty""] as const) {
        const files = value.orientationSources[role];
        if (!Array.isArray(files)) {
          diagnostics.push(`orientationSources.${role} must be an array`);
          continue;
        }
        if (files.length > MAX_ORIENTATION_ROLE_FILES) {
          diagnostics.push(
            `orientationSources.${role} exceeds the maximum of ${MAX_ORIENTATION_ROLE_FILES}`,
          );
        }
        if (files.some((file) =>
          typeof file !== ""string"" ||
          !file.trim() ||
          file.startsWith(""/"") ||
          /^[A-Za-z]:[\\/]/.test(file) ||
          file.split(/[\\/]+/u).includes("".."")
        )) {
          diagnostics.push(`orientationSources.${role} contains an invalid project-relative path`);
        }
      }
    }
  }
  if (options.requireOrientationSources) {
    if (!isRecord(value.orientationSources)) {
      diagnostics.push(""project_orientation requires orientationSources"");
    } else {
      const orientationSources = value.orientationSources as Record<string, unknown>;
      const roleFiles = ORIENTATION_ROLES.flatMap((role) => {
        const files = orientationSources[role];
        return Array.isArray(files)
          ? files.filter((file): file is string => typeof file === ""string"" && file.trim().length > 0)
          : [];
      });
      if (ORIENTATION_ROLES.some((role) => {
        const files = orientationSources[role];
        return !Array.isArray(files) || files.length === 0;
      })) {
        diagnostics.push(""project_orientation requires at least one source file per role"");
      }
      const targetFileSet = new Set(
        targetFiles.filter((file): file is string => typeof file === ""string"").map(normalizePlannerPath),
      );
      if (roleFiles.some((file) => !targetFileSet.has(normalizePlannerPath(file)))) {
        diagnostics.push(""orientationSources files must also appear in targetFiles"");
      }
      if (new Set(roleFiles.map(normalizePlannerPath)).size > 8) {
        diagnostics.push(""project_orientation source union exceeds the maximum of 8 files"");
      }
    }
  }

  const subQueries = Array.isArray(value.subQueries) ? value.subQueries : [];
  if (scope === ""broad"" && subQueries.length > 0 && subQueries.length < 2) {
    diagnostics.push(""broad plans require 2-5 subQueries"");
  }
  if (scope !== ""broad"" && subQueries.length > 0) {
    diagnostics.push(""subQueries are allowed only for broad plans"");
  }
  if (value.requiresToolUse === false && (targetFiles.length > 0 || subQueries.length > 0)) {
    diagnostics.push(""a no-tool plan cannot contain target files or subQueries"");
  }

  const parts = value.compoundParts === undefined
    ? []
    : Array.isArray(value.compoundParts)
      ? value.compoundParts
      : [];
  if (value.compoundParts !== undefined && !Array.isArray(value.compoundParts)) {
    diagnostics.push(""compoundParts must be an array"");
  }
  if (parts.length > 8) diagnostics.push(""compoundParts exceeds the maximum of 8"");
  const ids = new Set<string>();
  for (const part of parts) {
    if (!isRecord(part) || typeof part.id !== ""string"" || !part.id.trim()) {
      diagnostics.push(""compoundParts must have non-empty ids"");
      continue;
    }
    if (ids.has(part.id)) diagnostics.push(""compoundParts ids must be unique"");
    ids.add(part.id);
    if (typeof part.question !== ""string"" || !part.question.trim()) {
      diagnostics.push(""compoundParts questions must be non-empty"");
    }
    if (
      part.kind !== ""CURRENT_STATE"" &&
      part.kind !== ""FEATURES"" &&
      part.kind !== ""GAPS"" &&
      part.kind !== ""PRIORITIES"" &&
      part.kind !== ""OTHER""
    ) {
      diagnostics.push(""compoundParts contains an unsupported kind"");
    }
    if (typeof part.requiresCitation !== ""boolean"") {
      diagnostics.push(""compoundParts requiresCitation must be boolean"");
    }
    if (
      part.requiredCount !== undefined &&
      (typeof part.requiredCount !== ""number"" ||
        !Number.isInteger(part.requiredCount) ||
        part.requiredCount < 1 ||
        part.requiredCount > 10)
    ) {
      diagnostics.push(""compoundParts requiredCount must be an integer from 1-10"");
    }
  }

  return { valid: diagnostics.length === 0, diagnostics: [...new Set(diagnostics)] };
}

function parsePlannerResponse(
  raw: string | null,
  profile: ""default"" | ""project_orientation"" = ""default"",
): QueryPlan | null {
  if (!raw) return null;

  // Extract the first JSON object from the response (handles spurious prose)
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

    const validation = validateQueryPlanShape(parsed, {
      requireOrientationSources: profile === ""project_orientation"",
    });
    if (!validation.valid) return null;
    const scopeEstimate = parsed[""scopeEstimate""] as ScopeEstimate;
    const suggestedIterations = parsed[""suggestedIterations""] as number;

      return {
      originalIntent: typeof parsed[""originalIntent""] === ""string"" ? parsed[""originalIntent""] : """",
      targetFiles: Array.isArray(parsed[""targetFiles""])
        ? (parsed[""targetFiles""] as string[]).filter((f) => typeof f === ""string"").slice(0, MAX_TARGET_FILES)
        : [],
      targetEntities: Array.isArray(parsed[""targetEntities""])
        ? (parsed[""targetEntities""] as string[]).filter((e) => typeof e === ""string"").slice(0, 10)
        : [],
      scopeEstimate,
      suggestedIterations,
      requiresToolUse: parsed[""requiresToolUse""] as boolean,
      ...(typeof parsed[""targetConfidence""] === ""number""
        ? { targetConfidence: parsed[""targetConfidence""] }
        : {}),
      ...(isRecord(parsed[""orientationSources""])
        ? {
            orientationSources: {
              purpose: Array.isArray(parsed.orientationSources.purpose)
                ? parsed.orientationSources.purpose
                    .filter((file): file is string => typeof file === ""string"")
                    .slice(0, MAX_ORIENTATION_ROLE_FILES)
                : [],
              components: Array.isArray(parsed.orientationSources.components)
                ? parsed.orientationSources.components
                    .filter((file): file is string => typeof file === ""string"")
                    .slice(0, MAX_ORIENTATION_ROLE_FILES)
                : [],
              primaryFlow: Array.isArray(parsed.orientationSources.primaryFlow)
                ? parsed.orientationSources.primaryFlow
                    .filter((file): file is string => typeof file === ""string"")
                    .slice(0, MAX_ORIENTATION_ROLE_FILES)
                : [],
              uncertainty: Array.isArray(parsed.orientationSources.uncertainty)
                ? parsed.orientationSources.uncertainty
                    .filter((file): file is string => typeof file === ""string"")
                    .slice(0, MAX_ORIENTATION_ROLE_FILES)
                : [],
            },
          }
        : {}),
      subQueries: Array.isArray(parsed[""subQueries""])
        ? (parsed[""subQueries""] as string[]).filter((q) => typeof q === ""string"").slice(0, MAX_SUBQUERIES)
        : [],
      compoundParts: Array.isArray(parsed[""compoundParts""])
        ? (parsed[""compoundParts""] as Array<Record<string, unknown>>)
            .filter((part) => part && typeof part === ""object"" && typeof part.id === ""string"" && typeof part.question === ""string"")
            .slice(0, 8)
            .map((part, index) => ({
              id: part.id as string || `part-${index + 1}`,
              kind:
                part.kind === ""FEATURES"" || part.kind === ""GAPS"" || part.kind === ""PRIORITIES"" ||
                part.kind === ""CURRENT_STATE""
                  ? part.kind
                  : ""OTHER"",
              question: part.question as string,
              ...(typeof part.requiredCount === ""number"" && part.requiredCount > 0
                ? { requiredCount: Math.round(part.requiredCount) }
                : {}),
              requiresCitation: part.requiresCitation !== false,
            }))
        : [],
      planStatus: ""valid"",
      planDiagnostics: [],
      };
  } catch {
    return null;
  }
}

/**
 * An unresolved project question may use planner candidates as navigation
 * hints only when the planner is explicit about confidence and keeps the
 * source set narrow. Broad or unqualified candidates are discarded so the
 * prompt's source-first fallback remains authoritative.
 */
function constrainUnresolvedTargetPlan(
  plan: QueryPlan,
  targetResolution: ProjectQueryTargetResolution | undefined,
): QueryPlan {
  if (targetResolution !== ""unresolved"") return plan;

  const safe =
    plan.requiresToolUse &&
    plan.scopeEstimate !== ""broad"" &&
    plan.targetFiles.length > 0 &&
    plan.targetFiles.length <= MAX_TARGET_FILES &&
    typeof plan.targetConfidence === ""number"" &&
    plan.targetConfidence >= MIN_UNRESOLVED_TARGET_CONFIDENCE;
  const diagnostic = safe
    ? `unresolved target: using ${plan.targetFiles.length} high-confidence planner source candidates`
    : ""unresolved target: planner candidates were not safe to prefetch; use source-first discovery"";

  return {
    ...plan,
    targetResolution,
    targetMode: safe ? ""bounded_unresolved_hint"" : ""source_first_discovery"",
    targetFiles: safe ? plan.targetFiles.slice(0, MAX_UNRESOLVED_TARGET_FILES) : [],
    targetEntities: safe ? plan.targetEntities.slice(0, 4) : [],
    planDiagnostics: [...new Set([...(plan.planDiagnostics ?? []), diagnostic])].slice(0, 4),
  };
}

export function inferCompoundParts(message: string): CompoundQueryPart[] {
  const normalized = normalizeIntentText(message);
  const detectors: Array<{
    id: string;
    kind: CompoundPartKind;
    question: string;
    patterns: RegExp[];
    requiredCount?: number;
  }> = [
    {
      id: ""current-state"",
      kind: ""CURRENT_STATE"",
      question: ""What is the current project state?"",
      patterns: [
        /\b(?:current|currently|today|existing|implemented)\b/iu,
        /(?:الحالي|الحالية|حاليا|اليوم|الموجود|الموجودة|المطبق|المطبقة)/u,
      ],
    },
    {
      id: ""features"",
      kind: ""FEATURES"",
      question: ""What features or capabilities currently exist?"",
      patterns: [
        /\b(?:feature|features|capabilit\w*)\b/iu,
        /(?:وظائف|ميزات|إمكانات|امكانات)/u,
      ],
    },
    {
      id: ""gaps"",
      kind: ""GAPS"",
      question: ""What verified gaps or missing capabilities exist?"",
      patterns: [],
    },
    {
      id: ""priorities"",
      kind: ""PRIORITIES"",
      question: ""What should be prioritized based on the verified project state?"",
      patterns: [
        /\b(?:priorit(?:y|ies|ize|ise|ized|ised)|priority|priorities)\b/iu,
        /(?:اولوية|اولويات|رتب|ترتيب|الأولويات)/u,
      ],
    },
  ];

  const topThreePatterns = [
    /\b(?:top|first)\s+(?:three|3)\b/iu,
    /\btop\s*3\b/iu,
    /\bthree\s+(?:top|highest|priority|priorities)\b/iu,
    /(?:اول|اعلى)\s*(?:ثلاث|ثلاثة|3)/u,
    /(?:ثلاث|ثلاثة|3)\s+(?:اولوية|اولويات)/u,
  ];

  const firstMatchIndex = (patterns: RegExp[]): number | null => {
    let first: number | null = null;
    for (const pattern of patterns) {
      const match = pattern.exec(normalized);
      if (match && (first === null || match.index < first)) first = match.index;
    }
    return first;
  };

  const candidates = detectors.flatMap((detector) => {
    const index =
      detector.id === ""gaps""
        ? findGapAnalysisMatch(normalized)?.index ?? null
        : firstMatchIndex(detector.patterns);
    if (index === null) return [];

    const requiredCount =
      detector.id === ""priorities"" && firstMatchIndex(topThreePatterns) !== null
        ? 3
        : detector.requiredCount;
    return [{ ...detector, index, requiredCount }];
  });

  return candidates
    .sort((left, right) => left.index - right.index)
    .map(({ index: _index, patterns: _patterns, ...part }) => ({
      id: part.id,
      kind: part.kind,
      question: part.question,
      ...(part.requiredCount ? { requiredCount: part.requiredCount } : {}),
      requiresCitation: true,
    }));
}

// ── Deterministic graph-guided file planning ───────────────────────────────────

export type GraphGuidance = {
  mentionedFiles: string[];
  resolvedFiles: string[];
  /** Mentioned files plus direct file neighbours, and nothing broader. */
  prefetchFiles: string[];
  /** Bounded prompt-ready map with names, relationships, and source coordinates. */
  promptHint: string;
  /** Bounded, source-grounded traces for the explicit file scope. */
  crossFileTraces: CrossFileSemanticTrace[];
};

type GraphEvidenceLike = {
  file?: unknown;
  line?: unknown;
  column?: unknown;
  snippet?: unknown;
  kind?: unknown;
};

function graphEvidence(
  value: GraphEntity | GraphRelationship,
): GraphEvidenceLike[] {
  const direct =
    ""evidenceJson"" in value && Array.isArray(value.evidenceJson)
      ? value.evidenceJson
      : [];
  const provenance =
    value.provenance && Array.isArray(value.provenance.evidence)
      ? value.provenance.evidence
      : [];
  return [...direct, ...provenance] as GraphEvidenceLike[];
}

function graphCoordinate(
  value: GraphEntity | GraphRelationship,
  fallbackPath?: string | null,
): string | null {
  const evidence = graphEvidence(value);
  const located = evidence.find(
    (item) => typeof item.file === ""string"" && typeof item.line === ""number"",
  );
  if (located && typeof located.file === ""string"" && typeof located.line === ""number"") {
    return `${located.file}:${located.line}`;
  }
  const fileOnly = evidence.find((item) => typeof item.file === ""string"");
  if (fileOnly && typeof fileOnly.file === ""string"") return fileOnly.file;
  return fallbackPath ?? null;
}

function graphSourceSpan(
  value: GraphEntity | GraphRelationship,
): SemanticGraphEdge[""sourceSpan""] | undefined {
  const evidence = graphEvidence(value).find(
    (item) =>
      typeof item.file === ""string"" &&
      typeof item.line === ""number"" &&
      Number.isInteger(item.line) &&
      item.line > 0,
  );
  if (!evidence || typeof evidence.file !== ""string"" || typeof evidence.line !== ""number"") {
    return undefined;
  }
  return {
    file: evidence.file,
    line: evidence.line,
    ...(typeof evidence.column === ""number"" && Number.isInteger(evidence.column) && evidence.column >= 0
      ? { column: evidence.column }
      : {}),
    ...(typeof evidence.snippet === ""string"" && evidence.snippet.trim()
      ? { snippet: evidence.snippet.trim().slice(0, 240) }
      : {}),
  };
}

function graphNode(value: GraphEntity): SemanticGraphNode {
  return {
    id: value.id,
    name: value.name || value.path || value.id,
    ...(graphPath(value) ? { path: graphPath(value) as string } : {}),
    type: value.type,
  };
}

function graphPath(value: GraphEntity | null | undefined): string | null {
  const raw = value?.path?.trim();
  return raw ? raw.replace(/\\/g, ""/"").replace(/^\.\/+/, """") : null;
}

function graphRelationLabel(relationship: GraphRelationship): string {
  return relationship.relationType ?? relationship.relation ?? ""related"";
}

/**
 * Resolve explicit file mentions directly through the graph before the
 * model-driven planner runs. Only the mentioned file entities and their
 * depth-1 neighbours are admitted to this guidance/prefetch path.
 *
 * This is deliberately separate from `planQuery`: a model may still choose
 * useful target entities for broad questions, but it must not turn a concrete
 * `chat.ts` mention into an unrelated project-wide prefetch.
 */
export async function buildMentionedFileGraphGuidance(opts: {
  message: string;
  projectId: string;
}): Promise<GraphGuidance | null> {
  const mentionedFiles = extractMentionedFiles(opts.message);
  if (mentionedFiles.length === 0) return null;

  const build = async (): Promise<GraphGuidance | null> => {
    const roots = (await findFileEntities(db, opts.projectId, mentionedFiles))
      .slice(0, MAX_GRAPH_GUIDED_ROOTS);
    if (roots.length === 0) return null;

    const neighbourhoods = await Promise.all(
      roots.map(async (root) => ({
        root,
        result: await getNeighborhood(db, root.id, 1, opts.projectId).catch(() => ({
          root: null,
          entities: [],
          relationships: [],
        })),
      })),
    );

    const prefetchFiles: string[] = [];
    const seenFiles = new Set<string>();
    const addFile = (file: string | null): void => {
      if (!file || seenFiles.has(file) || prefetchFiles.length >= MAX_GRAPH_GUIDED_FILES) return;
      seenFiles.add(file);
      prefetchFiles.push(file);
    };

    const mapLines: string[] = [
      ""Graph-guided file map — use the mentioned files and direct neighbours first; do not explore unrelated files:"",
    ];
    const resolvedFiles: string[] = [];
    const crossFileTraces: CrossFileSemanticTrace[] = [];

    for (const { root, result } of neighbourhoods) {
      const rootPath = graphPath(root);
      if (rootPath) {
        resolvedFiles.push(rootPath);
        addFile(rootPath);
      }

      const entities = new Map<string, GraphEntity>();
      entities.set(root.id, root);
      for (const entity of result.entities) entities.set(entity.id, entity);

      const neighbours = result.relationships
        .map((relationship) => {
          const neighbourId =
            relationship.sourceId === root.id
              ? relationship.targetId
              : relationship.targetId === root.id
                ? relationship.sourceId
                : null;
          return neighbourId ? { relationship, entity: entities.get(neighbourId) } : null;
        })
        .filter(
          (entry): entry is { relationship: GraphRelationship; entity: GraphEntity } =>
            entry !== null && entry.entity !== undefined,
        )
        .sort((left, right) => {
          const leftTest = left.relationship.relationSubtype === ""test-covers"" ? 0 : 1;
          const rightTest = right.relationship.relationSubtype === ""test-covers"" ? 0 : 1;
          return leftTest - rightTest;
        })
        .slice(0, MAX_GRAPH_GUIDED_NEIGHBORS);

      const rootLabel = rootPath ?? root.name;
      mapLines.push(`- Mentioned \`${rootLabel}\` — direct neighbours:`);
      if (neighbours.length === 0) {
        mapLines.push(""  - (none recorded in the graph)"");
        continue;
      }

      for (const { relationship, entity } of neighbours) {
        const neighbourPath = graphPath(entity);
        if (entity.type === ""file"") addFile(neighbourPath);
        const coordinate = graphCoordinate(entity, neighbourPath) ??
          graphCoordinate(relationship, rootPath);
        const location = coordinate ? ` at ${coordinate}` : """";
        const relation = graphRelationLabel(relationship);
        const label =
          entity.name && neighbourPath && entity.name !== neighbourPath
            ? `${entity.name} in ${neighbourPath}`
            : entity.name || neighbourPath || entity.id;
        mapLines.push(`  - \`${label}\` via ${relation}${location}`);

        const sourceEntity = relationship.sourceId === root.id ? root : entity;
        const targetEntity = relationship.targetId === root.id ? root : entity;
        const sourceSpan = graphSourceSpan(relationship) ??
          graphSourceSpan(entity);
        if (
          sourceEntity.id !== targetEntity.id &&
          crossFileTraces.length < MAX_GRAPH_GUIDED_FILES
        ) {
          const traceNodes = [graphNode(sourceEntity), graphNode(targetEntity)];
          const edge: SemanticGraphEdge = {
            source: sourceEntity.id,
            target: targetEntity.id,
            relation,
            ...(sourceSpan ? { sourcePath: sourceSpan.file, sourceSpan } : {}),
            ...(sourceSpan
              ? {
                  evidence: [
                    typeof sourceSpan.column === ""number""
                      ? `${sourceSpan.file}:${sourceSpan.line}:${sourceSpan.column}`
                      : `${sourceSpan.file}:${sourceSpan.line}`,
                    sourceSpan.snippet ? ` — ${sourceSpan.snippet}` : """",
                  ].join(""""),
                }
              : {}),
          };
          crossFileTraces.push(buildCrossFileSemanticTrace({
            nodes: traceNodes,
            edges: [edge],
            from: sourceEntity.id,
            to: targetEntity.id,
            maxDepth: 1,
          }));
        }
      }
    }

    if (prefetchFiles.length === 0) return null;
    return {
      mentionedFiles,
      resolvedFiles: [...new Set(resolvedFiles)],
      prefetchFiles,
      promptHint: mapLines.join(""\n"").slice(0, 3_000),
      crossFileTraces,
    };
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      console.warn(
        JSON.stringify({
          scope: ""query-planner"",
          code: ""GRAPH_GUIDANCE_TIMEOUT"",
          projectId: opts.projectId,
          timeoutMs: GRAPH_GUIDANCE_TIMEOUT_MS,
        }),
      );
      resolve(null);
    }, GRAPH_GUIDANCE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([build().catch(() => null), timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ── Graph enrichment ──────────────────────────────────────────────────────────

/**
 * Enrich a QueryPlan's targetFiles with paths discovered from the knowledge
 * graph neighbourhood of the plan's targetEntities.
 *
 * Design:
 *   1. Search the graph for entities matching the planner's targetEntities.
 *   2. Run getNeighborhood (depth 2) on the top 5 matching entities.
 *   3. Collect the `path` field from every neighbour entity.
 *   4. Merge unique paths into targetFiles (total cap: MAX_GRAPH_FILES).
 *   5. The whole call is raced against a 2-second hard timeout — if the graph
 *      query is slow or the DB is unavailable the original plan is returned
 *      unchanged, so enrichment never blocks the main request.
 *
 * Only called when projectId is provided AND the project has a completed scan
 * (indicated by projectContext.metricsVerified).
 */
async function enrichPlanWithGraph(
  plan: QueryPlan,
  projectId: string,
): Promise<QueryPlan> {
  if (plan.targetEntities.length === 0) return plan;

  const enrichAsync = async (): Promise<QueryPlan> => {
    // Step 1: search the graph for matching entities.
    const matches = await searchNodes(db, projectId, plan.targetEntities);
    if (matches.length === 0) return plan;

    // Step 2: neighbourhood traversal on the top 5 candidates.
    const top5 = matches.slice(0, 5);
    const neighbourResults = await Promise.all(
      top5.map((entity) =>
        getNeighborhood(db, entity.id, 2).catch(() => null),
      ),
    );

    // Step 3: collect paths from all discovered entities.
    const graphPaths = new Set<string>();

    // Include root entities' own paths.
    for (const entity of top5) {
      if (entity.path) graphPaths.add(entity.path);
    }

    for (const result of neighbourResults) {
      if (!result) continue;
      if (result.root?.path) graphPaths.add(result.root.path);
      for (const entity of result.entities) {
        if (entity.path) graphPaths.add(entity.path);
      }
    }

    if (graphPaths.size === 0) return plan;

    // Step 4: merge with existing targetFiles, cap at MAX_GRAPH_FILES.
    const existing = new Set(plan.targetFiles);
    const merged = [...plan.targetFiles];

    for (const p of graphPaths) {
      if (merged.length >= MAX_GRAPH_FILES) break;
      if (!existing.has(p)) {
        merged.push(p);
        existing.add(p);
      }
    }

    console.info(
      JSON.stringify({
        scope: ""query-planner"",
        code: ""GRAPH_ENRICH_DONE"",
        projectId,
        addedFiles: merged.length - plan.targetFiles.length,
        totalFiles: merged.length,
      }),
    );

    return { ...plan, targetFiles: merged };
  };

  const timeout = new Promise<QueryPlan>((resolve) =>
    setTimeout(() => {
      console.warn(
        JSON.stringify({
          scope: ""query-planner"",
          code: ""GRAPH_ENRICH_TIMEOUT"",
          projectId,
          timeoutMs: GRAPH_ENRICH_TIMEOUT_MS,
        }),
      );
      resolve(plan);
    }, GRAPH_ENRICH_TIMEOUT_MS),
  );

  return Promise.race([enrichAsync().catch(() => plan), timeout]);
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Run the planning phase for a user query.
 *
 * Always resolves — returns FALLBACK_PLAN on any failure.
 * Callers should await this without a try/catch if they want the fallback
 * behaviour; wrap in .catch(() => null) if they want to distinguish failure
 * from the fallback.
 */
export async function planQuery(opts: {
  message: string;
  projectContext: ProjectContext;
  model: string;
  strategy: ProviderStrategy;
  apiKey?: string;
  /**
   * When provided alongside a scanned project (metricsVerified = true),
   * enrichPlanWithGraph() augments targetFiles with paths discovered from
   * the knowledge graph neighbourhood of targetEntities.
   */
  projectId?: string;
  signal?: AbortSignal;
  executionLedger?: ExecutionLedger;
  /** Server-owned target state used to constrain ambiguous planner output. */
  targetResolution?: ProjectQueryTargetResolution;
  /** Orientation asks for role-relevant sources and complete reads. */
  profile?: ""default"" | ""project_orientation"";
  /**
   * Bounded paths from the validated project filesystem manifest. These are
   * fallback navigation inputs only; the read tool remains authoritative
   * before any path becomes evidence.
   */
  orientationFallbackPaths?: readonly string[];
}): Promise<QueryPlan> {
  const {
    message,
    projectContext,
    model,
    strategy,
    apiKey,
    projectId,
    signal,
    executionLedger,
    targetResolution,
    profile = ""default"",
    orientationFallbackPaths = [],
  } = opts;
  const plannerStartedAt = Date.now();
  if (executionLedger && !executionLedger.admit(""planner"", { model, operation: ""query_plan"" })) {
    return fallbackPlanFor({
      message,
      targetResolution,
      profile,
      graphSummary: projectContext.graphSummary,
      orientationFallbackPaths,
      diagnostics: [""request execution budget exhausted before planning""],
    });
  }

  const plannerPrompt = buildPlannerPrompt(
    message,
    projectContext.graphSummary,
    targetResolution,
    profile,
  );
  const messages: RawMessage[] = [
    { role: ""system"", content: plannerPrompt },
    { role: ""user"", content: message },
  ];

  // Race the model call against a hard timeout so planning never blocks the
  // main request even when the provider is slow or unresponsive.
  const plannerCall = strategy
    .call(messages, {
      model,
      maxTokens: 512,
      timeoutMs: executionLedger?.timeoutMs(PLANNER_TIMEOUT_MS) ?? PLANNER_TIMEOUT_MS,
      apiKey,
      signal: executionLedger?.signal ?? signal,
      // No tools — the planner is a pure text completion
    })
    .then((r) => r)
    .catch((err: unknown) => {
      console.warn(
        JSON.stringify({
          scope: ""query-planner"",
          code: ""MODEL_ERROR"",
          model,
          reason: err instanceof Error ? err.message : String(err),
        }),
      );
      return null;
    });

  const timeoutSignal = new Promise<null>((resolve) =>
    setTimeout(() => resolve(null), PLANNER_TIMEOUT_MS),
  );

  const result = await Promise.race([plannerCall, timeoutSignal]);
  executionLedger?.complete(""planner"", {
    model,
    operation: ""query_plan"",
    startedAt: plannerStartedAt,
    status: result ? ""completed"" : ""failed"",
  });

  if (!result) {
    console.warn(JSON.stringify({ scope: ""query-planner"", code: ""TIMEOUT_OR_ERROR"", model }));
    return fallbackPlanFor({
      message,
      targetResolution,
      profile,
      graphSummary: projectContext.graphSummary,
      orientationFallbackPaths,
      diagnostics: [""planner timed out or returned no response""],
    });
  }

  const parsedPlan = parsePlannerResponse(result.content, profile);
  if (!parsedPlan) {
    let invalidDiagnostics = [""planner response was not a valid plan""];
    try {
      const jsonMatch = result.content?.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as unknown;
        const validation = validateQueryPlanShape(parsed, {
          requireOrientationSources: profile === ""project_orientation"",
        });
        if (!validation.valid) invalidDiagnostics = validation.diagnostics;
      }
    } catch {
      // Keep the bounded parser diagnostic; raw provider content is never
      // returned to callers.
    }
    console.warn(
      JSON.stringify({
        scope: ""query-planner"",
        code: ""PARSE_FAILED"",
        model,
        diagnostics: invalidDiagnostics.slice(0, 4),
      }),
    );
    return fallbackPlanFor({
      message,
      targetResolution,
      profile,
      graphSummary: projectContext.graphSummary,
      orientationFallbackPaths,
      planStatus: result.content ? ""invalid"" : ""fallback"",
      diagnostics: invalidDiagnostics,
    });
  }

  // ── Graph enrichment ───────────────────────────────────────────────────────
  // Only enrich when we have a project ID and the project has a completed scan
  // (metricsVerified = true).  Skipping on un-scanned projects avoids wasted
  // DB queries against an empty graph.
  const plan: QueryPlan = {
    ...parsedPlan,
    originalIntent: parsedPlan.originalIntent || message,
    compoundParts:
      parsedPlan.compoundParts.length > 0 ? parsedPlan.compoundParts : inferCompoundParts(message),
  };
  const normalizedPlan: QueryPlan = {
    ...plan,
    ...(targetResolution ? { targetResolution } : {}),
    ...(deriveProjectQueryTargetMode({
      targetResolution,
      targetFiles: plan.targetFiles,
      targetConfidence: plan.targetConfidence,
    })
      ? {
          targetMode: deriveProjectQueryTargetMode({
            targetResolution,
            targetFiles: plan.targetFiles,
            targetConfidence: plan.targetConfidence,
          }),
        }
      : {}),
    subQueries:
      plan.subQueries.length >= 2
        ? plan.subQueries
        : plan.compoundParts.length >= 2
          ? plan.compoundParts.map((part) => part.question).slice(0, MAX_SUBQUERIES)
          : plan.subQueries,
  };
  const constrainedPlan = constrainUnresolvedTargetPlan(
    normalizedPlan,
    targetResolution,
  );
  if (
    constrainedPlan.scopeEstimate === ""broad"" &&
    constrainedPlan.subQueries.length < 2
  ) {
    return {
      ...fallbackPlanFor({
        message,
        targetResolution,
        profile,
        graphSummary: projectContext.graphSummary,
        orientationFallbackPaths,
        planStatus: ""invalid"",
        diagnostics: [""broad plans require at least two focused subQueries""],
      }),
      ...(deriveProjectQueryTargetMode({ targetResolution })
        ? { targetMode: deriveProjectQueryTargetMode({ targetResolution }) }
        : {}),
    };
  }

  const enriched =
    projectId && projectContext.metricsVerified && targetResolution !== ""unresolved""
      ? await enrichPlanWithGraph(constrainedPlan, projectId)
      : constrainedPlan;

  console.info(
    JSON.stringify({
      scope: ""query-planner"",
      code: ""PLAN_READY"",
      scopeEstimate: enriched.scopeEstimate,
      suggestedIterations: enriched.suggestedIterations,
      targetFileCount: enriched.targetFiles.length,
      graphEnriched: enriched.targetFiles.length > constrainedPlan.targetFiles.length,
      subQueryCount: enriched.subQueries.length,
      requiresToolUse: enriched.requiresToolUse,
      targetResolution: enriched.targetResolution,
      targetConfidence: enriched.targetConfidence,
    }),
  );

  const graphEnriched = enriched.targetFiles.length > constrainedPlan.targetFiles.length;
  return graphEnriched ? { ...enriched, graphEnriched: true } : enriched;
}

// ── PR-011: file-level source plan vs actual coverage ─────────────────────────

export type PlannerTier = ""targeted"" | ""graph_enriched"" | ""fallback"";
export type FileOrigin = ""planned"" | ""model_chosen"";
export type FileReadStatus =
  | ""READ_COMPLETE""
  | ""READ_TRUNCATED""
  | ""READ_FAILED""
  | ""READ_SKIPPED"";

export type FileStatusEntry = {
  path: string;
  origin: FileOrigin;
  readStatus: FileReadStatus;
};

export type QuerySourceSelectionRecord = {
  plannerTier: PlannerTier;
  /** Up to 20 files from the query plan (post-graph-enrichment). */
  plannedFiles: string[];
  /** Up to 40 combined file statuses (planned + model-chosen). */
  fileStatuses: FileStatusEntry[];
  truncatedPlannedCount: number;
  skippedPlannedCount: number;
  orientationCoverage?: ProjectOrientationCoverage;
};

const MAX_PLANNED_FILES = 20;
const MAX_FILE_STATUSES = 40;

function normalizePath(p: string): string {
  return p.trim().replace(/\\/g, ""/"").replace(/^(?:\.\/)+/, """");
}

function toPublicReadStatus(raw: string | undefined): FileReadStatus {
  if (raw === ""READ_COMPLETE"" || raw === ""READ_CACHED"") return ""READ_COMPLETE"";
  if (raw === ""READ_TRUNCATED"") return ""READ_TRUNCATED"";
  if (raw === ""READ_FAILED"") return ""READ_FAILED"";
  return ""READ_SKIPPED"";
}

/**
 * Derive a bounded, server-owned coverage summary from the final query plan
 * and the combined read-status map (prefetch + tool-loop reads).
 *
 * This is a pure function with no external I/O. Callers build the map from
 * `prefetchReadStatuses` and per-file `ReadStatus` values extracted from
 * `AgentStep` tool_result entries after the loop finishes.
 */
export function deriveSourceSelectionRecord(
  plan: QueryPlan,
  finalReadStatuses: ReadonlyMap<string, string>,
): QuerySourceSelectionRecord {
  const orientationCoverage = deriveProjectOrientationCoverage(plan, finalReadStatuses);
  const plannerTier: PlannerTier =
    plan.planStatus === ""fallback"" || plan.planStatus === ""invalid""
      ? ""fallback""
      : plan.graphEnriched
      ? ""graph_enriched""
      : ""targeted"";

  const rawPlannedFiles = plan.targetFiles.slice(0, MAX_PLANNED_FILES);
  const plannedSet = new Set(rawPlannedFiles.map(normalizePath));

  const plannedStatuses: FileStatusEntry[] = rawPlannedFiles.map((path) => {
    const key = normalizePath(path);
    const directStatus = finalReadStatuses.get(key) ?? finalReadStatuses.get(path);
    const raw = directStatus ?? [...finalReadStatuses.entries()]
      .find(([candidatePath]) => normalizePath(candidatePath) === key)?.[1];
    return { path, origin: ""planned"", readStatus: toPublicReadStatus(raw) };
  });

  const modelChosenStatuses: FileStatusEntry[] = [];
  for (const [path, raw] of finalReadStatuses) {
    const key = normalizePath(path);
    if (!plannedSet.has(key)) {
      modelChosenStatuses.push({
        path,
        origin: ""model_chosen"",
        readStatus: toPublicReadStatus(raw),
      });
    }
  }

  const allStatuses = [
    ...plannedStatuses,
    ...modelChosenStatuses,
  ].slice(0, MAX_FILE_STATUSES);

  const truncatedPlannedCount = plannedStatuses.filter(
    (e) => e.readStatus === ""READ_TRUNCATED"",
  ).length;
  const skippedPlannedCount = plannedStatuses.filter(
    (e) => e.readStatus === ""READ_SKIPPED"",
  ).length;

  return {
    plannerTier,
    plannedFiles: rawPlannedFiles,
    fileStatuses: allStatuses,
    truncatedPlannedCount,
    skippedPlannedCount,
    ...(orientationCoverage ? { orientationCoverage } : {}),
  };
}

export type ProjectOrientationCoverage = {
  purpose: { plannedFiles: string[]; complete: boolean };
  components: { plannedFiles: string[]; complete: boolean };
  primaryFlow: { plannedFiles: string[]; complete: boolean };
  uncertainty: { plannedFiles: string[]; complete: boolean };
  complete: boolean;
  missingRoles: Array<""purpose"" | ""components"" | ""primaryFlow"" | ""uncertainty"">;
};

function statusForPath(
  path: string,
  finalReadStatuses: ReadonlyMap<string, string>,
): FileReadStatus {
  const key = normalizePath(path);
  const directStatus = finalReadStatuses.get(key) ?? finalReadStatuses.get(path);
  const raw = directStatus ?? [...finalReadStatuses.entries()]
    .find(([candidatePath]) => normalizePath(candidatePath) === key)?.[1];
  return toPublicReadStatus(raw);
}

/**
 * Orientation is accepted only when every bounded role has at least one
 * complete source read. The role manifest is planner output, while completion
 * is derived exclusively from server-observed prefetch/tool read statuses.
 */
export function deriveProjectOrientationCoverage(
  plan: QueryPlan,
  finalReadStatuses: ReadonlyMap<string, string>,
): ProjectOrientationCoverage | undefined {
  const roles = plan.orientationSources;
  if (!roles) return undefined;

  const roleNames = [""purpose"", ""components"", ""primaryFlow"", ""uncertainty""] as const;
  const coverage = Object.fromEntries(roleNames.map((role) => {
    const plannedFiles = [...new Set(roles[role].map(normalizePath).filter(Boolean))];
    const complete =
      plannedFiles.length > 0 &&
      plannedFiles.every((path) => statusForPath(path, finalReadStatuses) === ""READ_COMPLETE"");
    return [role, { plannedFiles, complete }];
  })) as Pick<ProjectOrientationCoverage, typeof roleNames[number]>;
  const missingRoles = roleNames.filter((role) => !coverage[role].complete);

  return {
    ...coverage,
    complete: missingRoles.length === 0,
    missingRoles: [...missingRoles],
  };
}

```",2026-09-19T21:01:34.550Z
f3755bf1-472f-4fee-a2bf-1d4d71fdbc6d,8e78c54c-23e5-445e-85ec-6e3816154184,lib/ai-orchestrator/src/evidence-integrity.ts,source,,,8e45a24ea052414db3a2a7f76a47c81d0e413619db01137a5e3f3740e3859c5b,104079,1,0,"File: lib/ai-orchestrator/src/evidence-integrity.ts
```
/**
 * Evidence Integrity & Claim Verification (EI-001…EI-023)
 *
 * Transforms the naive chain
 *     Source Read → Evidence Packet → Model Conclusion → Final Judgment
 * into a claim-centered, auditable chain:
 *     Source Read → Evidence Window → Claim → Claim-to-Evidence Binding
 *       → Verification → Behavioral Answer / Finding → Telemetry
 *
 * Invariant enforced end to end: **no Claim reaches Final Output unless it has
 * DIRECT evidence traceable to the same execution run** (EI-003).
 *
 * The module is deliberately pure and side-effect free so it can be unit-tested
 * exhaustively and reused by the engine, the chat agent, and the SSE layer.
 *
 * Addresses benchmark gaps G-22 (evidence↔claim mismatch) and G-23
 * (telemetry↔evidence-packet mismatch).
 */

import { createHash } from ""node:crypto"";
import ts from ""typescript"";
import type { ObjectiveVerdictKind } from ""./audit-telemetry.js"";
import type { ScopeExpansion } from ""./objective-scope.js"";

/**
 * Reserved keywords and common English stopwords that must never be chosen as a
 * claim symbol. Used by extractClaimSymbol to avoid issuing a targeted read for
 * a generic token like ""return"" or ""when"", which produces no useful line anchor.
 */
const WEAK_SYMBOL_TOKENS = new Set(
  (
    ""return if else for while switch case break continue function const let var new class interface type "" +
    ""import export from default extends try catch finally typeof instanceof this with when where what which "" +
    ""who whom whose why how that these those it its them their there here "" +
    ""the and or not no but are was were be been being is has have had do does did will would could should "" +
    ""can may might shall must to of in on at by for as into across over under within without between during "" +
    ""through out up down then than also only too very just about again further once "" +
    ""value val item each every all any some both few more most other another "" +
    ""your you we us our our get set add remove true false null undefined""
  ).split(/\s+/),
);

/** A compound identifier (camelCase or snake_case) is a much stronger symbol lead. */
function isCompoundIdentifier(token: string): boolean {
  return token.includes(""_"") || /[a-z][A-Z]/.test(token);
}

/**
 * EI-017: pick the meaningful code symbol to issue a targeted read for.
 *
 * The previous inline regex `evidence.match(/\b[a-zA-Z_][a-zA-Z0-9_]{3,}\b/)`
 * returned the FIRST identifier-like token, which is frequently a generic word
 * (""return"", ""when"", ""from""). A search for such a token matches nothing useful,
 * so the targeted read defaulted to lines 1..N — identical to a full read.
 *
 * Preference order (all skipping reserved words + stopwords, min 3 chars):
 *  1. compound (camelCase / snake_case) tokens in the evidence snippet;
 *  2. plain tokens in the evidence snippet;
 *  3. compound tokens in the finding title;
 *  4. plain tokens in the finding title.
 * Returns undefined when nothing meaningful is found so the caller can skip the
 * (useless) targeted read entirely.
 */
export function extractClaimSymbol(evidence: string, title = """"): string | undefined {
  const pickFrom = (text: string, wantCompound: boolean): string | undefined => {
    const stems: string[] = text.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/g) ?? [];
    const candidates = stems.filter(
      (token) =>
        token.length >= 3 &&
        !WEAK_SYMBOL_TOKENS.has(token.toLowerCase()) &&
        isCompoundIdentifier(token) === wantCompound,
    );
    // Longest compound / most descriptive identifier is the strongest anchor.
    return candidates.sort((a, b) => b.length - a.length)[0];
  };
  return (
    pickFrom(evidence, true) ??
    pickFrom(evidence, false) ??
    pickFrom(title, true) ??
    pickFrom(title, false)
  );
}

// ── EI-001 Canonical Evidence Identity ─────────────────────────────────────────

/** Read-type classification; mirrors the engine's source-retrieval read status. */
export type EvidenceReadType = ""COMPLETE"" | ""TARGETED"" | ""TRUNCATED"" | ""CACHED"" | ""FAILED"";

/** Source category of the evidence window. */
export type EvidenceSourceType = ""IMPLEMENTATION"" | ""TEST"" | ""CONFIG"" | ""UNKNOWN"";

/**
 * EI-033: the provenance scope of a source window. A window in a fixture can
 * prove a fixture-local claim but must never prove a production claim. Scopes
 * are ordered by how strong a proof they can carry:
 *   PRODUCTION > (FIXTURE | TEST | SPEC) > GENERATED > UNKNOWN
 */
export type EvidenceSourceScope =
  | ""PRODUCTION""
  | ""FIXTURE""
  | ""TEST""
  | ""SPEC""
  | ""GENERATED""
  | ""UNKNOWN"";

/**
 * EI-029: the scope a verdict (or a claim) is allowed to assert. This is the
 * ""scoped verdict"" that replaces the generic `FINDING PROVEN` with an exact
 * proof-boundary. NOT_PROVEN means no proof boundary was established at all.
 */
export type VerdictScope =
  | ""PRODUCTION""
  | ""FIXTURE_LOCAL""
  | ""TEST_LOCAL""
  | ""SPEC_LOCAL""
  | ""MIXED""
  | ""NOT_PROVEN"";

/**
 * EI-030: scoped finding statuses that replace the bare `FINDING_PROVEN`.
 * A finding that flips from production to fixture-local must lose the
 * production claim instead of asserting it (EI-031 scope-escalation guard).
 */
export type ScopedFindingStatus =
  | ""PRODUCTION_PROVEN""
  | ""FIXTURE_PROVEN""
  | ""TEST_PROVEN""
  | ""MIXED_EVIDENCE""
  | ""NOT_PROVEN"";

/** EI-002: lifecycle stages of an evidence object. */
export type EvidencePhase = ""SOURCE_READ"" | ""EVIDENCE_CREATED"" | ""EVIDENCE_SELECTED"" | ""EVIDENCE_ACCEPTED"";

/**
 * A single canonical evidence record. Every source read produces exactly one
 * of these keyed by `evidenceId`, and no evidence may appear in a report that
 * lacks `runId` + `readAttemptId` lineage (EI-001/003/018).
 */
export type EvidenceRecord = {
  evidenceId: string;
  /** Execution run this evidence belongs to. Must equal the current runId to count as fresh proof. */
  runId: string;
  taskId?: string;
  /** Project-relative source path. */
  file: string;
  /** Claim-relevant symbol this window supports (EI-013 selection starts here). */
  symbol?: string;
  startLine?: number;
  endLine?: number;
  sourceSpan?: { startLine: number; endLine: number };
  readType: EvidenceReadType;
  /** Phase in the EI-002 lifecycle (SOURCE_READ/EVIDENCE_CREATED/SELECTED/ACCEPTED). */
  phase: EvidencePhase;
  sourceType: EvidenceSourceType;
  readAttemptId?: string;
  /**
   * When the evidence was served from a cache populated by an earlier run,
   * this holds that origin run. Such evidence is lineage-tagged and is never
   * treated as fresh runtime proof (EI-003/022).
   */
  originRunId?: string;
  /** Present when recovered at an evidence gap (EI-017/018). */
  recoveryAttemptId?: string;
  /** Directness strength for EI-006 (assigned conservatively). */
  strength: EvidenceStrength;
  /**
   * EI-033: the provenance scope of this window (where the source lives). A
   * FIXTURE/TEST/SPEC window must never be treated as production proof.
   */
  sourceScope: EvidenceSourceScope;
  timestamp: number;
};

/** EI-006: evidence strength. CONTEXT_ONLY can never prove Behavior or a Finding. */
export type EvidenceStrength = ""DIRECT"" | ""INDIRECT"" | ""CONTEXT_ONLY"";

// ── EI-004 Claim Record ────────────────────────────────────────────────────────

export type ClaimStatus = ""SUPPORTED"" | ""UNSUPPORTED"" | ""NOT_PROVEN"";

/**
 * A claim about observable behavior. Holds explicit evidenceIds that must bind
 * to (at least one) DIRECT, same-run, production-source EvidenceRecord.
 */
export type ClaimRecord = {
  claimId: string;
  /** The behavior asserted in words (e.g. ""partial returned when lastTextSeen exists""). */
  text: string;
  taskType: string;
  /** The symbol the claim is about; evidence selection starts from this (EI-013). */
  symbol?: string;
  /**
   * AI-OBJ-007: the kind of assertion this claim makes. When set,
   * `validateClaim` runs the evidence relevance gate so that e.g. a behavioral
   * excerpt cannot be used to prove a C_PRODUCTION_REACHABILITY claim.
   */
  category?: ClaimCategory;
  /**
   * EI-032: the proof scope the claim asserts. Populated during verification
   * from the sourceScope of its DIRECT evidence; FIXTURE evidence cannot
   * produce a PRODUCTION-scoped claim (EI-031/033).
   */
  scope?: VerdictScope;
  evidenceIds: string[];
  status: ClaimStatus;
  /** EI-005: supporting relation — which evidenceId+span proves the claim. */
  binding?: ClaimEvidenceBinding;
};

/** EI-005 Claim→Evidence binding. Missing binding ⇒ REJECTED (EI-007). */
export type ClaimEvidenceBinding = {
  claimId: string;
  evidenceIds: string[];
  /** File-local source spans, one per evidenceId, in the same order. */
  sourceSpans: { file: string; startLine?: number; endLine?: number }[];
  /** Human-readable ""what relation proves the claim"". */
  relation: string;
};

// ── EI-007 Verification ────────────────────────────────────────────────────────

export type ClaimValidationResult = ""PROVEN"" | ""NOT_PROVEN"" | ""REJECTED"";

export type ClaimValidation = {
  claimId: string;
  result: ClaimValidationResult;
  /** Which of the EI-007 checks failed (evidence exists / same run / production / symbol / direct / covers). */
  reasons: string[];
};

// ── EI-009 Behavior vs Finding separation ──────────────────────────────────────

export type BehaviorStatus = ""PROVEN"" | ""NOT_PROVEN"" | ""NO_BEHAVIOR_REQUESTED"";
export type FindingStatus = ""PROVEN"" | ""NONE"" | ""NOT_PROVEN"";

/**
 * Behavior and Finding outcomes are independent. A correct behavioral answer
 * can be Behavior=PROVEN with Finding=NONE and must NOT be flattened to
 * NOT_PROVEN (EI-009, AI-009).
 */
export type BehaviorFindingStatus = {
  behavior: BehaviorStatus;
  finding: FindingStatus;
  /** True only when behavior itself lacks direct source proof. */
  behaviorUnsupported: boolean;
};

// ── EI-010 Canonical Run Ledger ────────────────────────────────────────────────

/**
 * Single source of truth for a run. All interfaces/tools read reconciliation
 * from this ledger (EI-010).
 */
export type RunLedger = {
  runId: string;
  taskId?: string;
  readAttempts: number;
  completedReads: number;   // distinct completed SOURCE_READ records
  targetedReads: number;
  cachedReads: number;
  /** Distinct files with at least one completed SOURCE_READ record. */
  uniqueFilesRead: number;
  /**
   * Canonical evidence projection consumed by persisted trace/UI surfaces.
   * These sets must not be reconstructed independently from tool events.
   */
  completedReadFiles?: string[];
  retainedBodyFiles?: string[];
  acceptedEvidenceFiles?: string[];
  acceptedClaimCount?: number;
  sourceCoverage?: CanonicalSourceCoverage;
  evidenceRecords: EvidenceRecord[];
  /** Distinct files with at least one accepted evidence record (packet-side). */
  evidenceFileCount: number;
  claims: ClaimRecord[];
  validations: ClaimValidation[];
  acceptedEvidenceCount: number;
  provenClaims: number;
  recoveryAttempts: number;
  /** EI-029: proof scope of the collected evidence; NOT_PROVEN when none established. */
  verdictScope: VerdictScope;
  /** EI-030: scoped finding status derived from the evidence scope. */
  scopedFindingStatus: ScopedFindingStatus;
  finalResult?: BehaviorFindingStatus;
  /**
   * AI-OBJ-011: objective completion telemetry. Present only when the run
   * declared an objective. `validateTelemetry` fails closed on any objective
   * telemetry that is inconsistent with the gate verdict or the evidence.
   */
  objectiveType?: string;
  requiredClaims?: string[];
  completedClaims?: string[];
  missingClaims?: string[];
  requiredEdges?: string[];
  provenEdges?: string[];
  /**
   * Proof basis for each closed objective edge. SOURCE_AST proves a direct
   * invocation in retained production source; RUNTIME_OBSERVED additionally
   * binds the edge to an observed execution trace. BOTH means both were present.
   */
  provenEdgeProofs?: Array<{
    edge: string;
    basis: ""SOURCE_AST"" | ""RUNTIME_OBSERVED"" | ""BOTH"";
  }>;
  /** Objective claims only; unlike acceptedClaimCount this excludes edges. */
  acceptedBehavioralClaimCount?: number;
  /** Closed edges supported by retained-source AST invocation evidence. */
  provenStructuralEdgeCount?: number;
  /** Closed edges supported by execution-bound runtime trace evidence. */
  provenRuntimeEdgeCount?: number;
  failedEdges?: string[];
  recoveryTriggered?: boolean;
  recoveryTarget?: string;
  /** AI-OBJ-011: bounded primary/expansion scope telemetry. */
  scopeExpansions?: ScopeExpansion[];
  /** Canonical paths that were attempted outside the objective scope. */
  unjustifiedReads?: string[];
  completionGateResult?: ObjectiveCompletionStatus;
  finalAnswerType?: ""PRODUCTION_REACHABILITY_ANSWER"" | ""BEHAVIORAL_ANSWER"" | ""NO_ANSWER"";
};

export type CanonicalSourceCoverage = {
  status: ""COMPLETE"" | ""PARTIAL"" | ""NONE"";
  /** Explicit file manifest retained in request order for scoped audits. */
  requestedFiles?: string[];
  roots: Array<{
    root: string;
    discoveredFiles: number;
    readFiles: number;
    unreadFiles: number;
    status: ""COMPLETE"" | ""EMPTY"" | ""PARTIAL"" | ""BUDGET_EXHAUSTED"";
  }>;
  reason?: string;
};

export type TelemetryReconciliation =
  | { consistent: true }
  | { consistent: false; code: ""TELEMETRY_INCONSISTENT""; violations: string[] };

// ── EI-029/030/031/033 Scope inference & validation ────────────────────────────

/** EI-029: infer the proof scope a set of evidence is allowed to assert. */
export function deriveVerdictScope(records: readonly EvidenceRecord[]): VerdictScope {
  const observed = new Set(records.map((r) => r.sourceScope ?? ""UNKNOWN""));
  const hasProduction = observed.has(""PRODUCTION"");
  const hasLocal = observed.has(""FIXTURE"") || observed.has(""TEST"") || observed.has(""SPEC"");
  if (hasProduction && hasLocal) return ""MIXED"";
  if (hasProduction) return ""PRODUCTION"";
  if (observed.has(""FIXTURE"")) return ""FIXTURE_LOCAL"";
  if (observed.has(""TEST"")) return ""TEST_LOCAL"";
  if (observed.has(""SPEC"")) return ""SPEC_LOCAL"";
  return ""NOT_PROVEN"";
}

/**
 * EI-030/031: map a set of evidence windows to a scoped finding status. The
 * scope-escalation guard is intrinsic: fixture/test/spec windows can only ever
 * yield a local status, never PRODUCTION_PROVEN.
 */
export function deriveScopedFindingStatus(records: readonly EvidenceRecord[]): ScopedFindingStatus {
  switch (deriveVerdictScope(records)) {
    case ""PRODUCTION"":
      return ""PRODUCTION_PROVEN"";
    case ""FIXTURE_LOCAL"":
      return ""FIXTURE_PROVEN"";
    case ""TEST_LOCAL"":
      return ""TEST_PROVEN"";
    case ""SPEC_LOCAL"":
      return ""TEST_PROVEN"";
    case ""MIXED"":
      return ""MIXED_EVIDENCE"";
    default:
      return ""NOT_PROVEN"";
  }
}

/**
 * EI-029/030: human-readable verdict label for a scoped finding status.
 *
 * A bare ""FINDING PROVEN"" is reserved for production-grade evidence only.
 * Fixture, test, and spec evidence must carry an explicit scope qualifier so
 * the caller cannot mistake a fixture-local proof for production reachability.
 *
 * NOT_PROVEN and MIXED_EVIDENCE return the generic label as a safe default;
 * callers that need a non-generic label must first confirm the finding was
 * accepted before using this helper.
 */
export function buildScopedVerdictLabel(status: ScopedFindingStatus): string {
  switch (status) {
    case ""PRODUCTION_PROVEN"":
      return ""FINDING PROVEN"";
    case ""FIXTURE_PROVEN"":
      return ""FIXTURE-LOCAL FINDING PROVEN — PRODUCTION REACHABILITY NOT PROVEN"";
    case ""TEST_PROVEN"":
      return ""TEST-LOCAL FINDING PROVEN — PRODUCTION REACHABILITY NOT PROVEN"";
    case ""MIXED_EVIDENCE"":
      return ""FINDING PROVEN (MIXED EVIDENCE SCOPE — fixture and production sources combined; production reachability requires additional verification)"";
    default:
      return ""FINDING PROVEN"";
  }
}

/**
 * EI-036: derive a scoped finding status directly from a list of source paths
 * (e.g. a recovered Repair Plan's target files), mirroring the per-file
 * classification that `emitForensicStatus` applies to an audit. This lets the
 * repair execution gate block a plan whose targets are fixture/test-only even
 * when the audit's derived status is not carried across the stateless handoff.
 */
export function deriveScopedFindingStatusFromPaths(
  paths: readonly string[],
): ScopedFindingStatus {
  const observed = new Set(paths.map((file) => classifySourceScope(file)));
  const hasProduction = observed.has(""PRODUCTION"");
  const hasLocal =
    observed.has(""FIXTURE"") || observed.has(""TEST"") || observed.has(""SPEC"");
  if (hasProduction && hasLocal) return ""MIXED_EVIDENCE"";
  if (hasProduction) return ""PRODUCTION_PROVEN"";
  if (observed.has(""FIXTURE"")) return ""FIXTURE_PROVEN"";
  if (observed.has(""TEST"") || observed.has(""SPEC"")) return ""TEST_PROVEN"";
  return ""NOT_PROVEN"";
}

/**
 * EI-033: can evidence of `evidenceScope` prove a claim asserting `claimScope`?
 * A FIXTURE/TEST/SPEC window can never prove a PRODUCTION claim.
 */
export function evidenceScopeSupportsClaimScope(
  evidenceScope: EvidenceSourceScope,
  claimScope: VerdictScope,
): boolean {
  if (claimScope === ""NOT_PROVEN"") return false;
  if (claimScope === ""MIXED"") {
    // A mixed claim must be supported by production-grade evidence at least once.
    return evidenceScope === ""PRODUCTION"";
  }
  if (claimScope === ""PRODUCTION"") return evidenceScope === ""PRODUCTION"";
  if (claimScope === ""FIXTURE_LOCAL"") return evidenceScope === ""FIXTURE"" || evidenceScope === ""PRODUCTION"";
  if (claimScope === ""TEST_LOCAL"") return evidenceScope === ""TEST"" || evidenceScope === ""PRODUCTION"";
  // SPEC_LOCAL
  return evidenceScope === ""SPEC"" || evidenceScope === ""PRODUCTION"";
}

// ── EI-036 Repair Scope Gate ────────────────────────────────────────────────────

/** Machine-backed reason why a repair step may or may not execute under a scoped verdict. */
export type RepairBlockReason =
  | ""REPAIR_ALLOWED""
  | ""REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION""
  | ""REPAIR_BLOCKED_SCOPE_NOT_PROVEN""
  | ""REPAIR_BLOCKED_MIXED_EVIDENCE"";

export type ScopedRepairGate =
  | { allowed: true; reason: RepairBlockReason; detail: string }
  | { allowed: false; reason: RepairBlockReason; detail: string };

/**
 * EI-036: gate repair execution on proof scope. Only a production-scope finding
 * is permitted to drive a repair plan. Fixture/test/proven-only, not-proven, and
 * mixed evidence all block repair with an explicit reason so a local proof can
 * never reach a proposed-change surface. Mirrors guardFinalJudgment's shape.
 */
export function scopedRepairGate(scopedFindingStatus: ScopedFindingStatus): ScopedRepairGate {
  switch (scopedFindingStatus) {
    case ""PRODUCTION_PROVEN"":
      return {
        allowed: true,
        reason: ""REPAIR_ALLOWED"",
        detail: ""Finding proven from production source evidence; repair may proceed."",
      };
    case ""FIXTURE_PROVEN"":
      return {
        allowed: false,
        reason: ""REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION"",
        detail: ""Finding proven only from fixture evidence (EI-031/033); the defect is not proven in production code."",
      };
    case ""TEST_PROVEN"":
      return {
        allowed: false,
        reason: ""REPAIR_BLOCKED_SCOPE_NOT_PRODUCTION"",
        detail: ""Finding proven only from test evidence (EI-031/033); the defect is not proven in production code."",
      };
    case ""MIXED_EVIDENCE"":
      return {
        allowed: false,
        reason: ""REPAIR_BLOCKED_MIXED_EVIDENCE"",
        detail: ""Finding rests on mixed production and fixture/test evidence; repair is blocked until a production-scope proof is established."",
      };
    case ""NOT_PROVEN"":
    default:
      return {
        allowed: false,
        reason: ""REPAIR_BLOCKED_SCOPE_NOT_PROVEN"",
        detail: ""Finding is not proven; repair cannot be gated to production scope."",
      };
  }
}

// ── Constructors ───────────────────────────────────────────────────────────────

let _idCounter = 0;
/** Short, human-friendly id like `E-001` / `C-001`. */
function seqId(prefix: string): string {
  _idCounter += 1;
  return `${prefix}-${String(_idCounter).padStart(3, ""0"")}`;
}

/** Derive a deterministic path span when line info is unknown. */
export function evidenceSpanFromContent(file: string, content: string): {
  startLine?: number;
  endLine?: number;
  sourceSpan?: { startLine: number; endLine: number };
} {
  const lines = content.split(""\n"");
  if (lines.length === 0) return {};
  const sourceSpan = { startLine: 1, endLine: lines.length };
  return { startLine: 1, endLine: lines.length, sourceSpan };
}

/**
 * EI-006: classify a window's strength. A configured constant that merely
 * exists in the file (`DEFAULT_MAX_ITERATIONS = 30`) is CONTEXT_ONLY. A branch
 * or return that reaches the symbol is DIRECT. Anything in between is INDIRECT.
 */
export function classifyEvidenceStrength(content: string, file = """"): EvidenceStrength {
  if (!content) return ""CONTEXT_ONLY"";
  // Direct behavioral markers: control flow that returns/produces a distinctive value.
  const hasControlFlow = /\b(?:if|else|switch|case|for|while|return|throw)\b/.test(content);
  const looksLikePureDeclaration =
    /^\s*(?:const|let|var|static|final|public|private|internal|export)\b[^;{}]*=\s*[^;{}\n]*;?\s*$/m.test(
      content,
    );
  // A configured constant like `DEFAULT_MAX_ITERATIONS = 30`.
  const isConfigConstant =
    /(?:DEFAULT|MAX|MIN|LIMIT|THRESHOLD|TIMEOUT|_DEFAULT|_MAX|COUNT)\w*\s*[:=]\s*[-0-9.]+/.test(
      content,
    ) ||
    looksLikePureDeclaration;
  if (hasControlFlow && !isConfigConstant) return ""DIRECT"";
  if (hasControlFlow || !isConfigConstant) return ""INDIRECT"";
  return ""CONTEXT_ONLY"";
}

/** Identity helper (collision-safe regardless of global counter reuse). */
export function buildEvidenceId(runId: string, file: string, readAttemptId: string): string {
  return createHash(""sha1"")
    .update(`${runId}|${file}|${readAttemptId}`)
    .digest(""hex"")
    .slice(0, 10);
}

/**
 * EI-001/002: produce a canonical EvidenceRecord for one source read.
 * `phase` selects the lifecycle stage. Defaults to EVIDENCE_CREATED for a
 * completed read that has been admitted into the evidence pool.
 */
export function createEvidenceRecord(input: {
  runId: string;
  taskId?: string;
  file: string;
  content?: string;
  readType?: EvidenceReadType;
  phase?: EvidencePhase;
  sourceType?: EvidenceSourceType;
  readAttemptId?: string;
  originRunId?: string;
  recoveryAttemptId?: string;
  symbol?: string;
  timestamp?: number;
  /**
   * EI-033: explicit provenance scope. When omitted it is derived from the
   * file path so a fixture/test/spec window is never mislabeled as production.
   */
  sourceScope?: EvidenceSourceScope;
  /**
   * File-local coordinates for the evidence window. When provided, overrides
   * the content-derived span so TARGETED reads can record the actual line range
   * within the source file rather than lines 1..N of the extracted window.
   */
  sourceSpan?: { startLine: number; endLine: number };
}): EvidenceRecord {
  const {
    runId,
    taskId,
    file,
    content = """",
    readType = ""COMPLETE"",
    phase = ""EVIDENCE_CREATED"",
    sourceType = ""IMPLEMENTATION"",
    readAttemptId = seqId(""RA""),
    originRunId,
    recoveryAttemptId,
    symbol,
    timestamp = Date.now(),
    sourceScope: callerSourceScope,
    sourceSpan: callerSourceSpan,
  } = input;
  // Caller-provided sourceSpan (e.g. from a targeted read) takes priority; fall
  // back to deriving the span from the content length.
  const derived = callerSourceSpan
    ? { startLine: callerSourceSpan.startLine, endLine: callerSourceSpan.endLine, sourceSpan: callerSourceSpan }
    : evidenceSpanFromContent(file, content);
  const { startLine, endLine, sourceSpan } = derived;
  // Cached evidence from an earlier run must never be treated as fresh proof.
  const effectiveReadType: EvidenceReadType =
    originRunId && readType === ""COMPLETE"" ? ""CACHED"" : readType;
  const strength = classifyEvidenceStrength(content, file);
  return {
    evidenceId: buildEvidenceId(runId, file, readAttemptId),
    runId,
    taskId,
    file,
    symbol,
    ...(startLine ? { startLine } : {}),
    ...(endLine ? { endLine } : {}),
    ...(sourceSpan ? { sourceSpan } : {}),
    readType: effectiveReadType,
    phase,
    sourceType,
    readAttemptId,
    ...(originRunId ? { originRunId } : {}),
    ...(recoveryAttemptId ? { recoveryAttemptId } : {}),
    strength,
    sourceScope: callerSourceScope ?? classifySourceScope(file),
    timestamp,
  };
}

/**
 * EI-033: infer the provenance scope of a source file from its path. Explicit
 * fixture/test/spec directories are always local scopes; everything else that
 * is real code resolves to PRODUCTION so a runtime window in app code carries
 * the strongest proof it is allowed to.
 */
export function classifySourceScope(file: string): EvidenceSourceScope {
  const normalized = file.replace(/\\/g, ""/"");
  // Directory-level overrides come first: a file under fixtures/ or mocks/ is
  // always FIXTURE regardless of extension, and a file under tests/ / specs/ is
  // always TEST regardless of extension.
  if (/(?:^|\/)(?:fixtures?|mocks?|__mocks__)\b/i.test(normalized)) return ""FIXTURE"";
  if (/(?:^|\/)(?:__tests__|tests?)\b/i.test(normalized) || /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(normalized)) {
    return ""TEST"";
  }
  if (/(?:^|\/)(?:specs?|features?)\b/i.test(normalized)) return ""SPEC"";
  if (/(?:^|\/)(?:dist|build|gen[^/]*|generated)\b/i.test(normalized)) return ""GENERATED"";
  // Language-specific test-file naming conventions that place test files
  // alongside production code (i.e. NOT inside a test/ directory):
  //   Go:     *_test.go
  //   Python: test_*.py  or  *_test.py
  //   Ruby:   *_spec.rb
  //   Rust:   files ending _test.rs (cargo's inline-test convention uses
  //           modules, but separate _test.rs files appear in some projects)
  //   Java/Kotlin: *Test.java, *Tests.java, *Spec.kt, etc.
  const base = normalized.split(""/"").pop() ?? """";
  if (/_test\.go$/i.test(base)) return ""TEST"";
  if (/^test_.*\.py$/i.test(base) || /_test\.py$/i.test(base)) return ""TEST"";
  if (/_spec\.rb$/i.test(base)) return ""TEST"";
  if (/_test\.rs$/i.test(base)) return ""TEST"";
  if (/(?:Test|Tests|Spec|IT)\.(?:java|kt)$/i.test(base)) return ""TEST"";
  // Cover the same implementation extensions as the runtime classifier so that
  // Python, Go, Rust, Java, Kotlin, Ruby, SQL, and shell files are treated as
  // production-scope evidence, not UNKNOWN (which falls through to NOT_PROVEN
  // in deriveVerdictScope and defeats the scoped-verdict boundary).
  if (/\.(?:[cm]?[jt]sx?|py|go|rs|java|kt|rb|sql|sh)$/i.test(normalized)) return ""PRODUCTION"";
  return ""UNKNOWN"";
}

/**
 * EI-001 acceptance criterion: every evidence record must carry a runId and a
 * readAttemptId. Returns violations (empty ⇒ compliant).
 */
export function validateEvidenceLineage(records: readonly EvidenceRecord[]): string[] {
  const violations: string[] = [];
  for (const record of records) {
    if (!record.runId) violations.push(`evidence ${record.evidenceId} missing runId`);
    if (!record.readAttemptId) violations.push(`evidence ${record.evidenceId} missing readAttemptId`);
    // EI-003/022: cached evidence from another run is allowed to exist but
    // must carry originRunId and must not be treated as fresh runtime proof.
    if (record.readType === ""CACHED"" && !record.originRunId) {
      violations.push(`cached evidence ${record.evidenceId} missing originRunId`);
    }
  }
  return violations;
}

// ── EI-004/005/007 Claim handling ─────────────────────────────────────────────

export function createClaim(input: {
  claimId?: string;
  text: string;
  taskType: string;
  symbol?: string;
  scope?: VerdictScope;
  /** AI-OBJ-007: the kind of assertion this claim makes (wires the relevance gate in validateClaim). */
  category?: ClaimCategory;
  evidenceIds?: string[];
  status?: ClaimStatus;
}): ClaimRecord {
  return {
    claimId: input.claimId ?? seqId(""C""),
    text: input.text,
    taskType: input.taskType,
    ...(input.symbol ? { symbol: input.symbol } : {}),
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.category ? { category: input.category } : {}),
    evidenceIds: input.evidenceIds ?? [],
    status: input.status ?? (input.evidenceIds && input.evidenceIds.length > 0 ? ""SUPPORTED"" : ""NOT_PROVEN""),
  };
}

/** Resolve symbol-match candidates from retained file contents (EI-013). */
export function selectEvidenceForClaim(
  claim: Pick<ClaimRecord, ""text"" | ""symbol"">,
  fileContents: ReadonlyMap<string, string>,
): { file: string; symbolHit: boolean; proximity: number; excerpt: string }[] {
  const candidates: { file: string; symbolHit: boolean; proximity: number; excerpt: string }[] = [];
  for (const [file, content] of fileContents) {
    if (!content) continue;
    const symbolHit = Boolean(claim.symbol && content.includes(claim.symbol));
    const claimTokens = claim.text
      .toLowerCase()
      .split(/\W+/)
      .filter((token) => token.length > 2);
    const hits = claimTokens.filter((token) => content.toLowerCase().includes(token)).length;
    const proximity = claimTokens.length > 0 ? hits / claimTokens.length : 0;
    // Bounded first window for ranking; not used as proof by itself.
    const firstLine = content.split(""\n"", 40).join(""\n"");
    candidates.push({ file, symbolHit, proximity, excerpt: firstLine.slice(0, 300) });
  }
  return candidates.sort((a, b) => rankingscore(b) - rankingscore(a));
}

function rankingscore(c: { symbolHit: boolean; proximity: number }): number {
  return (c.symbolHit ? 1 : 0) * 0.5 + c.proximity * 0.5;
}

/**
 * EI-014: rank evidence candidates for a claim. Higher is better. Factored as
 * symbolMatch + lineProximity + behavioralDirectness + productionConfidence.
 */
export function rankEvidenceForClaim(
  claim: Pick<ClaimRecord, ""text"" | ""symbol"">,
  candidates: EvidenceRecord[],
): { evidence: EvidenceRecord; score: number }[] {
  return candidates
    .map((evidence) => {
      const symbolMatch = claim.symbol ? (evidence.symbol === claim.symbol ? 1 : 0.25) : 0.5;
      // Line proximity: a narrower window (smaller relative span) ranks higher,
      // since it pinpoints the control-flow decision the claim is about.
      let spanWidth = Infinity;
      let contentLen = 1;
      if (evidence.sourceSpan && evidence.sourceSpan.endLine >= evidence.sourceSpan.startLine) {
        spanWidth = evidence.sourceSpan.endLine - evidence.sourceSpan.startLine + 1;
        contentLen = Math.max(spanWidth, 1);
      }
      const relativeSpan = spanWidth === Infinity ? 1 : Math.min(spanWidth / contentLen, 1);
      // Direct strength strongly dominates: CONTEXT_ONLY (config) ranks lowest.
      const proximity = 1 - relativeSpan;
      const directnessScore = evidence.strength === ""DIRECT"" ? 1 : evidence.strength === ""INDIRECT"" ? 0.5 : 0;
      const productionConfidence =
        evidence.sourceType === ""IMPLEMENTATION"" ? 1 : evidence.sourceType === ""CONFIG"" ? 0.4 : 0.6;
      const score = symbolMatch * 0.3 + proximity * 0.2 + directnessScore * 0.3 + productionConfidence * 0.2;
      return { evidence, score };
    })
    .sort((a, b) => b.score - a.score);
}

/** EI-005: build a claim→evidence binding, or return null when no evidence binds. */
export function bindClaimToEvidence(
  claim: ClaimRecord,
  records: readonly EvidenceRecord[],
): ClaimEvidenceBinding | null {
  const bound = records.filter((record) => claim.evidenceIds.includes(record.evidenceId));
  // A claim with declared evidenceIds none of which resolve to records is a
  // binding failure → REJECTED via validateClaim.
  if (claim.evidenceIds.length > 0 && bound.length === 0) return null;
  if (bound.length === 0) return null;
  const sourceSpans = bound.map((record) => ({
    file: record.file,
    startLine: record.sourceSpan?.startLine,
    endLine: record.sourceSpan?.endLine,
  }));
  return {
    claimId: claim.claimId,
    evidenceIds: bound.map((record) => record.evidenceId),
    sourceSpans,
    relation: `claim ""${claim.text}"" proven by ${bound
      .map((record) => `${record.file}${record.sourceSpan ? `:${record.sourceSpan.startLine}-${record.sourceSpan.endLine}` : """"}`)
      .join("", "")}`,
  };
}

// ── EI-007 Claim Validator ─────────────────────────────────────────────────────

export function validateClaim(
  claim: ClaimRecord,
  records: readonly EvidenceRecord[],
  opts: {
    runId: string;
    allowTestSources?: boolean;
    /**
     * AI-OBJ-007: source excerpts keyed by `evidenceId`. When provided and
     * `claim.category` is set, the evidence relevance gate is applied to each
     * bound record. The gate is fail-closed for C_PRODUCTION_REACHABILITY:
     * a missing or behaviorally-typed snippet causes the record to be excluded
     * from the proving set.
     */
    snippets?: ReadonlyMap<string, string>;
  } = { runId: """", allowTestSources: false },
): ClaimValidation {
  const reasons: string[] = [];
  // 1. Evidence exists + binding resolves.
  const bound = records.filter((record) => claim.evidenceIds.includes(record.evidenceId));
  if (claim.evidenceIds.length === 0) {
    reasons.push(""claim has no evidenceIds (EI-005 REJECTED)"");
    return { claimId: claim.claimId, result: ""REJECTED"", reasons };
  }
  if (bound.length === 0) {
    reasons.push(""declared evidenceIds resolve to no records (EI-005 REJECTED)"");
    return { claimId: claim.claimId, result: ""REJECTED"", reasons };
  }
  // A claim is PROVEN iff it has at least one DIRECT-capable, same-run, fresh,
  // production, symbol-linked, relevance-gated record. CONTEXT_ONLY / cached /
  // TEST / relevance-rejected windows cannot be proof (EI-006/003/007#3/AI-OBJ-007).
  const failureKinds: string[] = [];
  for (const record of bound) {
    if (record.strength === ""CONTEXT_ONLY"") {
      failureKinds.push(`${record.evidenceId} is CONTEXT_ONLY and cannot prove behavior (EI-006)`);
    }
    if (record.runId !== opts.runId) failureKinds.push(`${record.evidenceId} from different run`);
    if (record.readType === ""CACHED"" && record.originRunId) {
      failureKinds.push(`${record.evidenceId} is cached from run ${record.originRunId}, not fresh proof (EI-003)`);
    }
    if (!opts.allowTestSources && record.sourceType === ""TEST"") {
      failureKinds.push(`${record.evidenceId} is TEST source, not production (EI-007#3)`);
    }
    // EI-033: scope-escalation guard
    if (claim.scope && !evidenceScopeSupportsClaimScope(record.sourceScope ?? ""PRODUCTION"", claim.scope)) {
      failureKinds.push(
        `${record.evidenceId} sourceScope ${record.sourceScope ?? ""UNKNOWN""} cannot support claim scope ${claim.scope} (EI-033)`,
      );
    }
    if (claim.symbol && record.symbol && record.symbol !== claim.symbol) {
      failureKinds.push(`${record.evidenceId} symbol mismatch`);
    }
    // AI-OBJ-007: evidence relevance gate — applied when the claim carries a
    // category so behavioral/import evidence cannot prove reachability claims.
    if (claim.category) {
      const snippet = opts.snippets?.get(record.evidenceId) ?? """";
      const gate = evidenceRelevanceGate(
        { strength: record.strength, file: record.file },
        claim.category,
        snippet,
        { targetSymbol: claim.symbol },
      );
      if (!gate.relevant) {
        failureKinds.push(`${record.evidenceId} relevance rejected: ${gate.reason}`);
      }
    }
  }
  const provingKinds = bound.filter((record) => {
    if (record.strength === ""CONTEXT_ONLY"") return false;
    if (record.runId !== opts.runId) return false;
    if (record.readType === ""CACHED"" && record.originRunId) return false;
    if (!opts.allowTestSources && record.sourceType === ""TEST"") return false;
    if (claim.scope && !evidenceScopeSupportsClaimScope(record.sourceScope ?? ""PRODUCTION"", claim.scope)) return false;
    if (claim.symbol && record.symbol && record.symbol !== claim.symbol) return false;
    // AI-OBJ-007: relevance gate — mirrors the per-record failure check above.
    if (claim.category) {
      const snippet = opts.snippets?.get(record.evidenceId) ?? """";
      const gate = evidenceRelevanceGate(
        { strength: record.strength, file: record.file },
        claim.category,
        snippet,
        { targetSymbol: claim.symbol },
      );
      if (!gate.relevant) return false;
    }
    return true;
  });
  if (provingKinds.length === 0) {
    reasons.push(...(failureKinds.length > 0 ? failureKinds : bound.map((r) => `${r.evidenceId} cannot prove the claim (EI-007)`)));
    return { claimId: claim.claimId, result: ""NOT_PROVEN"", reasons: reasons.slice(0, 6) };
  }
  return { claimId: claim.claimId, result: ""PROVEN"", reasons: [] };
}

// ── EI-008 Final-Judgment guard ────────────────────────────────────────────────

export type FinalJudgmentGuard =
  | { allowed: true; reason: string }
  | { allowed: false; code: ""VERIFICATION_FAILURE""; reason: string };

/**
 * A PROVEN Final Judgment is only allowed to pass when it carries claimId →
 * evidenceIds → source spans → validator decision. Anything less is a
 * VERIFICATION_FAILURE and must not be rendered as PROVEN (EI-008).
 */
export function guardFinalJudgment(input: {
  claims: readonly ClaimRecord[];
  validations: readonly ClaimValidation[];
  records: readonly EvidenceRecord[];
  runId: string;
}): FinalJudgmentGuard {
  if (input.claims.length === 0) {
    return { allowed: false, code: ""VERIFICATION_FAILURE"", reason: ""no claim is bound to any evidence (EI-008)"" };
  }
  for (const claim of input.claims) {
    const validation = input.validations.find((v) => v.claimId === claim.claimId);
    if (!validation) {
      return { allowed: false, code: ""VERIFICATION_FAILURE"", reason: `claim ${claim.claimId} lacks a validator decision` };
    }
    if (validation.result !== ""PROVEN"") {
      return {
        allowed: false,
        code: ""VERIFICATION_FAILURE"",
        reason: `claim ${claim.claimId} is ${validation.result}: ${validation.reasons.join(""; "")}`,
      };
    }
    const binding = claim.binding ?? bindClaimToEvidence(claim, input.records);
    if (!binding || binding.evidenceIds.length === 0) {
      return { allowed: false, code: ""VERIFICATION_FAILURE"", reason: `claim ${claim.claimId} has no resolved evidence binding` };
    }
    if (binding.sourceSpans.length === 0) {
      return { allowed: false, code: ""VERIFICATION_FAILURE"", reason: `claim ${claim.claimId} lacks source spans` };
    }
  }
  return { allowed: true, reason: `all ${input.claims.length} claim(s) verified PROVEN with bound evidence` };
}

/**
 * AI-OBJ-007: the category of a claim — what kind of assertion it makes.
 *
 * Different claim categories require fundamentally different evidence. A
 * behavioral excerpt proving _how_ a function computes can never satisfy a
 * production-reachability claim that demands a _call site_ between two symbols.
 *
 * Categories:
 *  - C_BEHAVIOR: how a function behaves (control flow, return values, side effects).
 *  - C_PRODUCTION_REACHABILITY: that a production caller reaches a target symbol
 *    at runtime — requires a direct call-site or data-flow span, never just an
 *    import or a description of what the target does.
 *  - C_FINDING: a defect / bug assertion proven by a code pattern.
 *  - C_STRUCTURAL: presence/absence of declarations, configurations, imports.
 */
export type ClaimCategory =
  | ""C_BEHAVIOR""
  | ""C_PRODUCTION_REACHABILITY""
  | ""C_FINDING""
  | ""C_STRUCTURAL"";
export function buildBehaviorFindingStatus(input: {
  behaviorSupported: boolean;
  behaviorRequested: boolean;
  findingProven: boolean;
}): BehaviorFindingStatus {
  const { behaviorSupported, behaviorRequested, findingProven } = input;
  if (!behaviorRequested) {
    return { behavior: ""NO_BEHAVIOR_REQUESTED"", finding: findingProven ? ""PROVEN"" : ""NONE"", behaviorUnsupported: false };
  }
  return {
    behavior: behaviorSupported ? ""PROVEN"" : ""NOT_PROVEN"",
    finding: findingProven ? ""PROVEN"" : ""NONE"",
    behaviorUnsupported: !behaviorSupported,
  };
}

// ── EI-011/012 Run Ledger + Telemetry Reconciliation ───────────────────────────

/**
 * The core inconsistency the plan targets: a packet may claim `1 implementation
 * file` while the run recorded `0 completed source reads`. This reconciles the
 * ledger and fails closed.
 */
export function buildRunLedger(input: {
  runId: string;
  taskId?: string;
  evidenceRecords: EvidenceRecord[];
  claims: ClaimRecord[];
  validations: ClaimValidation[];
  recoveryAttempts?: number;
  acceptedEvidenceCount?: number;
  finalResult?: BehaviorFindingStatus;
  sourceCoverage?: CanonicalSourceCoverage;
}): RunLedger {
  const {
    runId,
    taskId,
    evidenceRecords,
    claims,
    validations,
    recoveryAttempts = 0,
    finalResult,
    sourceCoverage,
  } = input;
  const completed = evidenceRecords.filter(
    (record) => (record.readType === ""COMPLETE"" || record.readType === ""TARGETED"") && !record.originRunId,
  );
  const readAttempts = evidenceRecords.length;
  const completedReads = completed.length;
  const targetedReads = evidenceRecords.filter((record) => record.readType === ""TARGETED"").length;
  const cachedReads = evidenceRecords.filter((record) => record.readType === ""CACHED"").length;
  const uniqueFilesRead = new Set(completed.map((record) => record.file)).size;
  const evidenceFileCount = new Set(evidenceRecords.map((record) => record.file)).size;
  const acceptedEvidenceCount = evidenceRecords.filter((record) => record.phase === ""EVIDENCE_ACCEPTED"").length;
  const completedReadFiles = [...new Set(completed.map((record) => record.file))];
  const retainedBodyFiles = [
    ...new Set(
      evidenceRecords
        .filter((record) => record.readType === ""COMPLETE"" || record.readType === ""TARGETED"")
        .map((record) => record.file),
    ),
  ];
  const acceptedEvidenceFiles = [
    ...new Set(
      evidenceRecords
        .filter((record) => record.phase === ""EVIDENCE_ACCEPTED"")
        .map((record) => record.file),
    ),
  ];
  const provenClaims = validations.filter((v) => v.result === ""PROVEN"").length;
  const verdictScope = deriveVerdictScope(evidenceRecords);
  const scopedFindingStatus = deriveScopedFindingStatus(evidenceRecords);
  return {
    runId,
    taskId,
    readAttempts,
    completedReads,
    targetedReads,
    cachedReads,
    uniqueFilesRead,
    completedReadFiles,
    retainedBodyFiles,
    acceptedEvidenceFiles,
    acceptedClaimCount: provenClaims,
    sourceCoverage,
    evidenceRecords,
    evidenceFileCount,
    claims,
    validations,
    acceptedEvidenceCount,
    provenClaims,
    recoveryAttempts,
    scopeExpansions: [],
    unjustifiedReads: [],
    verdictScope,
    scopedFindingStatus,
    finalResult,
  };
}

/**
 * EI-011/EI-012: enforce the counter invariants:
 *   uniqueFilesRead == distinct completed SOURCE_READ records
 *   evidenceFileCount <= uniqueFilesRead
 *   acceptedEvidenceCount <= evidenceRecords
 *   provenClaims <= claims
 * Any violation ⇒ TELEMETRY_INCONSISTENT, which must block PROVEN/PASS output.
 */
export function validateTelemetry(ledger: RunLedger): TelemetryReconciliation {
  const violations: string[] = [];
  const completedRecords = ledger.evidenceRecords.filter(
    (record) => (record.readType === ""COMPLETE"" || record.readType === ""TARGETED"") && !record.originRunId,
  );
  const distinctCompleted = new Set(completedRecords.map((record) => record.file)).size;
  // EI-026: completedReads = count(COMPLETED source reads).
  if (ledger.completedReads !== completedRecords.length) {
    violations.push(
      `completedReads ${ledger.completedReads} != count(COMPLETED source reads) ${completedRecords.length}`,
    );
  }
  // EI-026: uniqueFiles = distinct(files in COMPLETED source reads).
  if (ledger.uniqueFilesRead !== distinctCompleted) {
    violations.push(
      `uniqueFilesRead ${ledger.uniqueFilesRead} != distinct completed SOURCE_READ records ${distinctCompleted}`,
    );
  }
  // EI-026: evidenceFiles <= uniqueFiles.
  if (ledger.evidenceFileCount > ledger.uniqueFilesRead) {
    violations.push(
      `evidenceFileCount ${ledger.evidenceFileCount} > uniqueFilesRead ${ledger.uniqueFilesRead} (evidence without a completed read)`,
    );
  }
  // EI-026: acceptedEvidence <= evidenceRecords.
  if (ledger.acceptedEvidenceCount > ledger.evidenceRecords.length) {
    violations.push(
      `acceptedEvidenceCount ${ledger.acceptedEvidenceCount} > evidenceRecords ${ledger.evidenceRecords.length}`,
    );
  }
  // EI-026: provenClaims <= claims.
  if (ledger.provenClaims > ledger.claims.length) {
    violations.push(`provenClaims ${ledger.provenClaims} > claims ${ledger.claims.length}`);
  }
  // EI-031: a PRODUCTION verdict requires at least one production-grade window.
  // fixture/test/spec-only evidence can never assert production proof.
  if (ledger.verdictScope === ""PRODUCTION"") {
    const hasProductionEvidence = ledger.evidenceRecords.some(
      (record) => record.sourceScope === ""PRODUCTION"" || record.sourceScope === ""GENERATED"",
    );
    if (!hasProductionEvidence) {
      violations.push(
        ""verdictScope PRODUCTION asserted with no production-source evidence (EI-031 scope escalation)"",
      );
    }
  }
  const lineage = validateEvidenceLineage(ledger.evidenceRecords);
  violations.push(...lineage);
  // AI-OBJ-011: fail-closed objective completion telemetry. Whenever the run
  // declared an objective (objectiveType present), the remaining objective
  // fields must reconcile exactly with the completion gate verdict and the
  // evidence counts — otherwise the run's objective telemetry is judged
  // inconsistent and the verdict is blocked. A malformed objective status must
  // never pass silently as a completed production-reachability proof.
  if (ledger.objectiveType !== undefined) {
    if (
      ledger.requiredClaims === undefined ||
      ledger.completedClaims === undefined ||
      ledger.missingClaims === undefined
    ) {
      violations.push(
        ""objective telemetry incomplete: requiredClaims/completedClaims/missingClaims all required when objectiveType is set"",
      );
    } else {
      const missingSet = new Set(ledger.missingClaims);
      const overlap = ledger.completedClaims.filter((c) => missingSet.has(c));
      if (overlap.length > 0) {
        violations.push(`objective claims overlap completed+missing: ${overlap.join("", "")}`);
      }
      for (const c of ledger.completedClaims) {
        if (!ledger.requiredClaims.includes(c)) {
          violations.push(`completedClaims ${c} is not a required claim`);
        }
      }
      for (const c of ledger.missingClaims) {
        if (!ledger.requiredClaims.includes(c)) {
          violations.push(`missingClaims ${c} is not a required claim`);
        }
      }
      if (
        ledger.completedClaims.length + ledger.missingClaims.length !==
        ledger.requiredClaims.length
      ) {
        violations.push(
          `objective claim counts misaligned: completed ${ledger.completedClaims.length} + missing ${ledger.missingClaims.length} != required ${ledger.requiredClaims.length}`,
        );
      }
    }
    if (ledger.scopeExpansions === undefined || ledger.unjustifiedReads === undefined) {
      violations.push(
        ""objective telemetry incomplete: scopeExpansions/unjustifiedReads are required when objectiveType is set"",
      );
    } else {
      const unjustifiedFromExpansions = ledger.scopeExpansions
        .filter((expansion) => expansion.kind === ""UNJUSTIFIED_SCOPE_EXPANSION"")
        .map((expansion) => expansion.path);
      const missingUnjustifiedTelemetry = unjustifiedFromExpansions.filter(
        (path) => !ledger.unjustifiedReads!.includes(path),
      );
      if (missingUnjustifiedTelemetry.length > 0) {
        violations.push(
          `unjustified scope expansions missing from unjustifiedReads: ${missingUnjustifiedTelemetry.join("", "")}`,
        );
      }
      const foreignUnjustifiedReads = ledger.unjustifiedReads.filter(
        (path) => !unjustifiedFromExpansions.includes(path),
      );
      if (foreignUnjustifiedReads.length > 0) {
        violations.push(
          `unjustifiedReads not represented by scopeExpansions: ${foreignUnjustifiedReads.join("", "")}`,
        );
      }
      if (ledger.unjustifiedReads.length > 0 && ledger.completionGateResult === ""PROVEN"") {
        violations.push(""completionGateResult PROVEN with unjustified objective scope reads"");
      }
    }
    // Required edges must be fully partitioned into proven + failed (no
    // overlap, no gaps) so the gate's edge verdict is auditable.
    if (ledger.requiredEdges !== undefined) {
      const failedSet = new Set(ledger.failedEdges ?? []);
      const edgeOverlap = (ledger.provenEdges ?? []).filter((e) => failedSet.has(e));
      if (edgeOverlap.length > 0) {
        violations.push(`objective edges overlap proven+failed: ${edgeOverlap.join("", "")}`);
      }
      const accounted = [...(ledger.provenEdges ?? []), ...(ledger.failedEdges ?? [])];
      const unaccounted = ledger.requiredEdges.filter((e) => !accounted.includes(e));
      const foreign = accounted.filter((e) => !ledger.requiredEdges!.includes(e));
      if (unaccounted.length > 0) {
        violations.push(`required edges unaccounted for: ${unaccounted.join("", "")}`);
      }
      if (foreign.length > 0) {
        violations.push(`proven/failed edges not required: ${foreign.join("", "")}`);
      }
    }
    // Completion verdict consistency: a PROVEN gate result may never be
    // recorded alongside missing claims/edges. Conversely, a gate result that
    // is ""*not* blocked"" (PROVEN or PARTIALLY_PROVEN) may never be recorded
    // while zero required claims/edges are proven. The special failure statuses
    // (OBJECTIVE_MISMATCH, RECOVERY_SCOPE_FAILURE) and NOT_PROVEN/BLOCKED do not
    // promise any proof, so they are exempt.
    if (ledger.completionGateResult === ""PROVEN"") {
      if ((ledger.missingClaims?.length ?? 0) > 0) {
        violations.push(""completionGateResult PROVEN but missingClaims is non-empty"");
      }
      if ((ledger.failedEdges?.length ?? 0) > 0) {
        violations.push(""completionGateResult PROVEN but failedEdges is non-empty"");
      }
      const requiredElementCount =
        (ledger.requiredClaims?.length ?? 0) + (ledger.requiredEdges?.length ?? 0);
      const provenElementCount =
        (ledger.completedClaims?.length ?? 0) + (ledger.provenEdges?.length ?? 0);
      if (requiredElementCount > 0 && provenElementCount === 0) {
        violations.push(
          ""completionGateResult PROVEN with zero completed claims and proven edges"",
        );
      }
    } else if (
      ledger.completionGateResult !== undefined &&
      ledger.completionGateResult !== ""NOT_PROVEN"" &&
      ledger.completionGateResult !== ""BLOCKED"" &&
      ledger.completionGateResult !== ""OBJECTIVE_MISMATCH"" &&
      ledger.completionGateResult !== ""RECOVERY_SCOPE_FAILURE""
    ) {
      const anyProven =
        (ledger.completedClaims?.length ?? 0) > 0 || (ledger.provenEdges?.length ?? 0) > 0;
      if (!anyProven) {
        violations.push(
          `completionGateResult ${ledger.completionGateResult} recorded with zero proven claims/edges`,
        );
      }
    }
  }
  if (violations.length > 0) return { consistent: false, code: ""TELEMETRY_INCONSISTENT"", violations };
  return { consistent: true };
}

/**
 * AI-OBJ-011: attach objective completion telemetry onto a RunLedger from a
 * computed gate result. Returns a new ledger (the original is untouched). When
 * no objective was declared, or the gate is null, returns the ledger unchanged.
 * The callback may supply the recovery flag/target so recovery-triggered runs
 * are recorded too.
 */
export function attachObjectiveTelemetry(
  ledger: RunLedger,
  gate: ObjectiveCompletionGateResult | null,
  objective: { objectiveType: string } | undefined,
  recovery?: { triggered?: boolean; target?: string },
): RunLedger {
  if (!objective || !gate) return ledger;
  return {
    ...ledger,
    objectiveType: objective.objectiveType,
    requiredClaims: gate.requiredClaims,
    completedClaims: gate.completedClaims,
    missingClaims: gate.missingClaims,
    requiredEdges: gate.requiredEdges,
    provenEdges: gate.provenEdges,
    failedEdges: gate.missingEdges,
    recoveryTriggered: Boolean(recovery?.triggered),
    recoveryTarget: recovery?.target,
    completionGateResult: gate.status,
    finalAnswerType:
      gate.status === ""PROVEN"" && objective.objectiveType === ""PRODUCTION_REACHABILITY""
        ? ""PRODUCTION_REACHABILITY_ANSWER""
        : gate.status === ""PROVEN"" && objective.objectiveType.startsWith(""PROJECT_QUERY_"")
          ? ""BEHAVIORAL_ANSWER""
        : gate.answerTypeMismatch
          ? ""BEHAVIORAL_ANSWER""
          : ""NO_ANSWER"",
  };
}

// ── EI-015 Evidence-Backed Final Answer ────────────────────────────────────────

export type EvidenceBackedAnswer = {
  answer: string;
  claimIds: string[];
  evidenceIds: string[];
  status: ""PROVEN"" | ""NOT_PROVEN"";
};

/** Render a behavioral answer that is only allowed outward once its claims are PROVEN. */
export function buildEvidenceBackedAnswer(input: {
  answer: string;
  claims: readonly ClaimRecord[];
  validations: readonly ClaimValidation[];
}): EvidenceBackedAnswer {
  const provenClaims = input.claims.filter((claim) =>
    input.validations.some(
      (v) => v.claimId === claim.claimId && v.result === ""PROVEN"",
    ),
  );
  return {
    answer: input.answer,
    claimIds: provenClaims.map((claim) => claim.claimId),
    evidenceIds: provenClaims.flatMap((claim) => claim.evidenceIds),
    status: provenClaims.length > 0 ? ""PROVEN"" : ""NOT_PROVEN"",
  };
}

// ── EI-016 Claim-oriented evidence map ─────────────────────────────────────────

/**
 * Never render ""this file was read"". Render ""these lines prove this behavior"".
 * Each entry names the claim, the binding, and the exact supporting spans.
 */
export function buildClaimOrientedEvidenceMap(
  claims: readonly ClaimRecord[],
  records: readonly EvidenceRecord[],
): string[] {
  const lines: string[] = [];
  for (const claim of claims) {
    const bound = records.filter((record) => claim.evidenceIds.includes(record.evidenceId));
    if (bound.length === 0) {
      lines.push(`⚠️ claim ""${claim.text}"" has no bound evidence`);
      continue;
    }
    for (const record of bound) {
      const span = record.sourceSpan
        ? `:${record.sourceSpan.startLine}-${record.sourceSpan.endLine}`
        : """";
      lines.push(`✔️ ""${claim.text}"" → ${record.file}${span} (${record.strength})`);
    }
  }
  return lines;
}

/**
 * Build a RunLedger from the runtime evidence already collected in chat-agent:
 * the retained file bodies (evidence windows) and the engine's source-retrieval
 * telemetry. This is the single reconciliation seam for EI-011.
 */
export function buildRuntimeLedger(input: {
  runId: string;
  taskId?: string;
  fileContents: ReadonlyMap<string, string>;
  /** Files cited by accepted behavior evidence (claim-relevant windows). */
  acceptedFiles?: string[];
  claims?: readonly ClaimRecord[];
  validations?: readonly ClaimValidation[];
  /** Engine source-retrieval telemetry (SR-008). */
  sourceRetrieval?: {
    readAttempts?: number;
    uniqueReads?: number;
    targetedReads?: number;
    cachedReads?: number;
    readPaths?: readonly string[];
    scopeExpansions?: readonly ScopeExpansion[];
  };
  /**
   * Prefetch completed reads (EI-011). Files retained as evidence bodies via
   * plan/graph/memory prefetch are genuine completed source reads, but the loop
   * engine telemetry (recordRead) never sees them. Fold them in explicitly so
   * the reconciled uniqueFilesRead reflects ALL completed reads this run —
   * otherwise a well-formed prefetch-only run would report 0 reads and trip
   * INCONSISTENT purely because prefetch escapes the loop counter.
   */
  prefetchReads?: number;
  /**
   * Prefer the concrete prefetch paths when available. A count alone cannot
   * distinguish a prefetch that duplicates a loop read or a recovery window,
   * which can inflate uniqueFilesRead and trip EI-026.
   */
  prefetchPaths?: readonly string[];
  recoveryAttempts?: number;
  finalResult?: BehaviorFindingStatus;
  /**
   * Scope labels describe Finding proof only. Deterministic no-finding
   * fallbacks must not inherit a stale PRODUCTION_PROVEN label.
   */
  scopedFindingStatusOverride?: ScopedFindingStatus;
  /**
   * EI-017/018: pre-built targeted evidence records produced during claim
   * recovery. These carry `readType: ""TARGETED""`, a `recoveryAttemptId`, and
   * the same `runId` as the enclosing run — they are appended to the normal
   * complete-read records so they appear in the run ledger and contribute to
   * `targetedReads` / `recoveryAttempts` counters.
   */
  additionalRecoveryRecords?: readonly EvidenceRecord[];
  /** Deterministic source/root coverage for the same run. */
  sourceCoverage?: CanonicalSourceCoverage;
}): RunLedger {
  const {
    runId,
    taskId,
    fileContents,
    acceptedFiles = [],
    claims = [],
    validations = [],
    sourceRetrieval,
    prefetchReads = 0,
    prefetchPaths = [],
    recoveryAttempts = 0,
    finalResult,
    scopedFindingStatusOverride,
    additionalRecoveryRecords = [],
    sourceCoverage,
  } = input;
  const records: EvidenceRecord[] = [];
  for (const [file, content] of fileContents) {
    const isAccepted = acceptedFiles.includes(file);
    const record = createEvidenceRecord({
      runId,
      taskId,
      file,
      content,
      readType: ""COMPLETE"",
      phase: isAccepted ? ""EVIDENCE_ACCEPTED"" : ""EVIDENCE_CREATED"",
      sourceType: classifySourcePath(file),
    });
    records.push(record);
  }
  // EI-018: append targeted recovery records (already tagged with recoveryAttemptId).
  for (const rec of additionalRecoveryRecords) {
    records.push(rec);
  }
  const ledger = buildRunLedger({
    runId,
    taskId,
    evidenceRecords: records,
    claims: [...claims],
    validations: [...validations],
    recoveryAttempts,
    finalResult,
    sourceCoverage,
  });
  // EI-011: the ledger's uniqueFilesRead must come from the reconciled engine
  // telemetry (loop uniqueReads + prefetch completed reads), NOT re-derived
  // from retained bodies. Prefetch reads are folded in explicitly (they are
  // genuine completed reads the loop counter never sees); any residual gap
  // between evidenceFileCount and uniqueFilesRead is a real telemetry loss that
  // must fail closed — never masked by a silent evidence-derived fallback.
  const observedReadPaths = new Set([
    ...(sourceRetrieval?.readPaths ?? []),
    ...prefetchPaths,
    ...additionalRecoveryRecords.map((record) => record.file),
  ]);
  const reconciledUniqueReads =
    observedReadPaths.size > 0
      ? observedReadPaths.size
      : (sourceRetrieval?.uniqueReads ?? 0) + prefetchReads;
  const scopeExpansions = [...(sourceRetrieval?.scopeExpansions ?? [])];
  const unjustifiedReads = scopeExpansions
    .filter((expansion) => expansion.kind === ""UNJUSTIFIED_SCOPE_EXPANSION"")
    .map((expansion) => expansion.path);
  return {
    ...ledger,
    uniqueFilesRead: reconciledUniqueReads,
    scopeExpansions,
    unjustifiedReads,
    ...(scopedFindingStatusOverride
      ? { scopedFindingStatus: scopedFindingStatusOverride }
      : {}),
  };
}

function classifySourcePath(file: string): EvidenceSourceType {
  if (/(?:^|\/)(?:__tests__|test|tests|spec|specs|fixtures?)\b/i.test(file)) return ""TEST"";
  if (/(?:^|\/)(?:package\.json|tsconfig[^/]*\.json|vitest\.config\.[cm]?[jt]s|\.env\b)/i.test(file)) {
    return ""CONFIG"";
  }
  if (/\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh)$/i.test(file)) return ""IMPLEMENTATION"";
  return ""UNKNOWN"";
}

// ── EI-017/018 Recovery ────────────────────────────────────────────────────────

/**
 * Parse the output of `search_code` (grep) and return the first line number
 * whose project-relative file path exactly equals `targetFile`. Returns
 * `undefined` when no match is found in `targetFile` — callers must skip the
 * targeted read rather than falling back to an unanchored default line.
 *
 * grep output format (after root-prefix stripping): `path/to/file:N:content`
 * or `path/to/file:N-content` (context lines). We match both separators.
 *
 * This is a pure helper exported for testability; it is intentionally separate
 * from the recovery orchestration so it can be covered by cheap unit tests.
 */
export function findAnchorInSearchOutput(
  searchOut: string,
  targetFile: string,
): number | undefined {
  for (const line of searchOut.split(""\n"")) {
    const m = line.match(/^(.+?):(\d+)[:-]/);
    if (m && m[1] === targetFile) {
      return parseInt(m[2], 10);
    }
  }
  return undefined;
}

/**
 * When a claim fails validation (CLAIM_UNSUPPORTED), recovery targets the
 * claim's symbol with a targeted read rather than re-scanning the tree.
 * Returns the read attempt id to persist on recovered evidence (EI-018).
 */
export function planEvidenceRecovery(claim: ClaimRecord): {
  recoveryAttemptId: string;
  missingSymbol: string;
  targetedRead: { path: string; symbol: string };
} {
  const recoveryAttemptId = seqId(""REC"");
  const missingSymbol = claim.symbol ?? ""symbol"";
  return {
    recoveryAttemptId,
    missingSymbol,
    targetedRead: { path: claim.symbol ?? ""(resolve symbol)"", symbol: missingSymbol },
  };
}

/** EI-018: tag recovered evidence with the recovery attempt id + bump recovery count. */
export function tagRecoveredEvidence(
  record: EvidenceRecord,
  recoveryAttemptId: string,
): EvidenceRecord {
  return { ...record, recoveryAttemptId };
}

// ── AI-OBJ-005 Objective Completion Gate ────────────────────────────────────────

/**
 * The gate's verdict. PROVEN/PARTIALLY_PROVEN/NOT_PROVEN describe the objective's
 * evidence quality; BLOCKED is the fail-closed outcome when the objective cannot
 * be completed with the evidence at hand and the run MUST NOT emit a final answer.
 */
export type ObjectiveCompletionStatus =
  | ""PROVEN""
  | ""PARTIALLY_PROVEN""
  | ""NOT_PROVEN""
  | ""BLOCKED""
  /**
   * AI-OBJ-009/013-T5: recovery exceeded the bounded objective scope (read
   * non-required files) while trying to close a missing edge/symbol. A
   * production-reachability objective may never be finalized from an
   * unjustified over-broad recovery scan.
   */
  | ""RECOVERY_SCOPE_FAILURE""
  /**
   * AI-OBJ-007/013-T6: the model answered with a behavioral explanation of the
   * target instead of a production-reachability proof. A behavioral excerpt can
   * never satisfy a reachability claim, so the objective is refused regardless
   * of any evidence an explanation happens to contain.
   */
  | ""OBJECTIVE_MISMATCH"";

/**
 * AI-OBJ-005: every required edge a run must *directly prove* about a declared
 * objective. Structural shape only (keeps this pure module cycle-free).
 */
export type ObjectiveEvidenceEdgeRef = {
  from: string;
  to: string;
  relationship?: string;
};

/**
 * AI-OBJ-014: strip a path-qualified edge/link endpoint (`path#symbol`) down to
 * its symbol segment. Bare ids (""executor:run"", ""getGraphCentrality"") are
 * returned unchanged. Used to anchor runtime derivations to retained reads.
 */
export function symbolOfPathQualified(id: string): string {
  const hash = id.lastIndexOf(""#"");
  return hash >= 0 ? id.slice(hash + 1) : id.trim();
}

/**
 * AI-OBJ-013/014: the bounded file scope a PRODUCTION_REACHABILITY objective
 * actually declares. Only derivable when EVERY required edge endpoint is
 * path-qualified (`path#symbol`); a bare-symbol objective (""getGraphCentrality"")
 * carries no file bound and returns `null` (indeterminate) so callers never
 * flag a violation they cannot substantiate. Never derived from what was read.
 */
export function deriveObjectiveBoundedFileScope(
  objective: {
    requiredEvidenceEdges?: readonly ObjectiveEvidenceEdgeRef[];
  } | undefined,
): Set<string> | null {
  const edges = objective?.requiredEvidenceEdges ?? [];
  if (edges.length === 0) return null;
  const files = new Set<string>();
  for (const edge of edges) {
    for (const endpoint of [edge.from, edge.to]) {
      const m = /^(.*?)#[^#]+$/.exec(endpoint);
      if (!m) return null; // bare-symbol endpoint => no derivable bound
      files.add(m[1]!);
    }
  }
  return files.size > 0 ? files : null;
}

/**
 * AI-OBJ-007/013-T6: a candidate is an *answer-type mismatch* when the model
 * answered a PRODUCTION_REACHABILITY objective with accepted behavior evidence
 * (a behavioral substitute) while NO required reachability edge is directly
 * proven. Reviewer constraint honored: only gated for reachability objectives
 * (never behavior objectives), and accepted behavior EVIDENCE is required — an
 * explicit behavior query alone is not proof of a behavioral substitute run.
 */
export function deriveObjectiveAnswerTypeMismatch(input: {
  objective?: {
    objectiveType?: string;
    requiredEvidenceEdges?: readonly ObjectiveEvidenceEdgeRef[];
  } | null;
  /** True when behavior evidence was actually accepted for the candidate. */
  hasAcceptedBehaviorEvidence: boolean;
  provenEdges?: readonly { from?: string; to?: string }[];
}): boolean {
  const objective = input.objective;
  if (!objective || objective.objectiveType !== ""PRODUCTION_REACHABILITY"") return false;
  const edges = objective.requiredEvidenceEdges ?? [];
  if (edges.length === 0) return false;
  if (!input.hasAcceptedBehaviorEvidence) return false;
  const provenKeys = new Set(
    (input.provenEdges ?? [])
      .filter((e) => e.from && e.to)
      .map((e) => `${e.from}->${e.to}`),
  );
  const anyEdgeProven = edges.some((e) => provenKeys.has(`${e.from}->${e.to}`));
  return !anyEdgeProven;
}

/**
 * Syntax-aware source parse helper. Parses a retained body as a TypeScript
 * source file so declaration nodes and genuine call sites can be told apart
 * structurally instead of by fragile regex prefix matching. Files whose
 * extension is not TS/JS are parsed in JS mode (best-effort); callers only use
 * this for the reachability edge proof, so an unrecognisable body simply yields
 * no call sites and the edge stays unproven (fail-closed).
 */
function parseRetainedSource(body: string, file = ""retained.ts""): ts.SourceFile {
  const isTs = /\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs)$/i.test(file);
  return ts.createSourceFile(
    file,
    body,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    isTs ? ts.ScriptKind.TS : ts.ScriptKind.JS,
  );
}

/**
 * True when `expr` is a callable reference that resolves to `sym`: a bare
 * identifier `sym(...)` OR a property-access / element-access callee whose bound
 * name is `sym` (e.g. `obj.sym(...)`, `this.sym(...)`, `ns[""sym""](...)`).
 * A MethodDeclaration / object-shorthand method `computeCentrality(graph) {}`
 * is NOT a CallExpression, so it is structurally excluded here.
 */
function calleeResolvesTo(expr: ts.Expression, sym: string): boolean {
  if (ts.isIdentifier(expr)) return expr.text === sym;
  if (ts.isPropertyAccessExpression(expr)) {
    const name = expr.name;
    return ts.isIdentifier(name) ? name.text === sym : name.text === sym;
  }
  if (ts.isElementAccessExpression(expr)) {
    const arg = expr.argumentExpression;
    return ts.isStringLiteral(arg) ? arg.text === sym : false;
  }
  return false;
}

function sourceLineAt(body: string, pos: number): string {
  const lineStart = body.lastIndexOf(""\n"", pos) + 1;
  const lineEnd = body.indexOf(""\n"", pos);
  return body.slice(lineStart, lineEnd === -1 ? body.length : lineEnd).trim();
}

/**
 * Genuine call sites in `body` invoking `sym`. Only true `CallExpression` /
 * `NewExpression` nodes qualify — function/method/typed-method/interface
 * declarations are different AST node kinds and can never be returned here.
 */
function invocationSitesFor(body: string, sym: string, file?: string): string[] {
  const source = parseRetainedSource(body, file);
  const lines: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
      if (calleeResolvesTo(node.expression, sym)) {
        lines.push(sourceLineAt(body, node.getStart(source)));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return lines;
}

/**
 * AI-OBJ-013/014: direct invocation site of `sym` inside a retained body, or
 * `null` when the only appearances are imports/declarations. A bare `import { x }`,
 * `function x(`, an object/class method shorthand `x(...) {...}`, or a typed
 * method `x(...): T` are all declaration AST nodes and are NEVER returned here —
 * only a genuine `x(...)` call expression proves a runtime invocation.
 */
export function directInvocationEvidence(body: string, sym: string): string | null {
  return invocationSitesFor(body, sym)?.[0] ?? null;
}

/**
 * AI-OBJ-014 (review fix 3): derive runtime-observed production edges from the
 * run's *retained reads* (the intended runtime-observation path) instead of
 * injecting pre-fabricated `productionTraceLinks`. An objective edge `from->to`
 * is proven only when a retained PRODUCTION read (a) structurally DECLARES the
 * `from` symbol as a callable scoped object and (b) contains a DIRECT invocation
 * of the `to` symbol INSIDE that caller's body.
 *
 * Unlike the earlier co-occurrence test (which only required `from` to appear
 * somewhere in the file), the invocation is now BOUND to the caller: it must
 * live within a function-like node named `from`, not merely in the same file.
 * For a path-qualified `from` endpoint (`path#symbol`), the retained file must
 * also be the declared caller file.
 */
export function deriveObjectiveRuntimeEdgesFromRetainedReads(input: {
  objective?: {
    requiredEvidenceEdges?: readonly ObjectiveEvidenceEdgeRef[];
  } | null;
  fileContents: ReadonlyMap<string, string>;
  /**
   * Server-owned full source bodies used to bind a retained read to a
   * caller's complete AST body when the accepted read is only a bounded
   * window. These bodies are never counted as accepted evidence by
   * themselves; the caller file must still have a retained read in
   * fileContents.
   */
  objectiveEvidenceSources?: ReadonlyMap<string, string>;
}): { from: string; to: string; source?: string; evidence?: string }[] {
  const edges = input.objective?.requiredEvidenceEdges ?? [];
  if (edges.length === 0 || input.fileContents.size === 0) return [];
  const out: { from: string; to: string; source?: string; evidence?: string }[] = [];
  for (const edge of edges) {
    const rawFrom = symbolOfPathQualified(edge.from);
    const toSym = symbolOfPathQualified(edge.to);
    if (!rawFrom || !toSym) continue;
    const fromFile = pathSegmentOfQualified(edge.from);

    for (const [file, body] of input.fileContents) {
      if (classifySourceScope(file) !== ""PRODUCTION"") continue;
      if (fromFile) {
        const f = normalizeScopePath(file);
        if (f !== fromFile && !f.endsWith(`/${fromFile}`) && !fromFile.endsWith(`/${f}`)) continue;
      }
      // Structurally bind the invocation to the caller's body.
      const evidence = invocationInsideCaller(body, rawFrom, toSym, file);
      if (evidence) {
        out.push({ from: edge.from, to: edge.to, source: file, evidence });
        break;
      }
    }
    if (out.some((proven) => proven.from === edge.from && proven.to === edge.to)) continue;

    // A bounded retained window can contain the evidence needle without
    // containing the declaration of a large caller function. Bind the edge
    // against the server-owned source body in that case, but only when the
    // same caller file was also retained as accepted run evidence. This keeps
    // locator bodies out of the evidence ledger while avoiding a false
    // negative caused by an arbitrary provider-selected window.
    if (!input.objectiveEvidenceSources) continue;
    for (const [file, body] of input.objectiveEvidenceSources) {
      if (classifySourceScope(file) !== ""PRODUCTION"") continue;
      if (fromFile) {
        const f = normalizeScopePath(file);
        if (f !== fromFile && !f.endsWith(`/${fromFile}`) && !fromFile.endsWith(`/${f}`)) continue;
      }
      const retainedCallerRead = [...input.fileContents.keys()].some((retainedFile) => {
        const retained = normalizeScopePath(retainedFile);
        const locator = normalizeScopePath(file);
        return retained === locator
          || retained.endsWith(`/${locator}`)
          || locator.endsWith(`/${retained}`);
      });
      if (!retainedCallerRead) continue;
      const evidence = invocationInsideCaller(body, rawFrom, toSym, file);
      if (evidence) {
        out.push({ from: edge.from, to: edge.to, source: file, evidence });
        break;
      }
    }
  }
  return out;
}

/** Normalise a file path for caller-file binding (leading `./`, backslashes). */
function normalizeScopePath(pathLike: string): string {
  return pathLike.trim().replace(/\\/g, ""/"").replace(/^\.\/+/, """");
}

/** The `path` segment of a `path#symbol` endpoint, or `null` when not qualified. */
function pathSegmentOfQualified(endpoint: string): string | null {
  const m = /^(.*?)#[^#]+$/.exec(endpoint);
  return m ? normalizeScopePath(m[1]!) : null;
}

/**
 * Find a genuine `toSym(...)` call that lives within a function-like node named
 * `callerSym` in `body`. Returns the call's source line, or `null`. This binds
 * the edge proof to the caller's actual body rather than symbol co-occurrence.
 */
function invocationInsideCaller(
  body: string,
  callerSym: string,
  toSym: string,
  file: string,
): string | null {
  const source = parseRetainedSource(body, file);
  const callers: ts.Node[] = [];
  const visit = (node: ts.Node): void => {
    const nameOf = (n?: ts.Node): string | undefined =>
      n && ts.isIdentifier(n) ? n.text : undefined;
    if (ts.isFunctionDeclaration(node) && nameOf(node.name) === callerSym) callers.push(node);
    else if (ts.isMethodDeclaration(node) && nameOf(node.name) === callerSym) callers.push(node);
    else if (ts.isClassDeclaration(node) && nameOf(node.name) === callerSym) callers.push(node);
    else if (ts.isVariableDeclaration(node) && nameOf(node.name) === callerSym) {
      const init = node.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) callers.push(node);
    } else if (ts.isPropertyAssignment(node) && nameOf(node.name) === callerSym) {
      const init = node.initializer;
      if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init))) callers.push(node);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  if (callers.length === 0) return null;
  // Search within each caller subtree — a call to `toSym` only counts if it is
  // actually inside the caller's body, never a same-file independent occurrence.
  for (const caller of callers) {
    let found: string | null = null;
    const scan = (node: ts.Node): boolean => {
      if (found) return true;
      if (ts.isCallExpression(node) || ts.isNewExpression(node)) {
        if (calleeResolvesTo(node.expression, toSym)) {
          found = sourceLineAt(body, node.getStart(source));
          return true;
        }
      }
      return ts.forEachChild(node, scan) as unknown as boolean;
    };
    scan(caller);
    if (found) return found;
  }
  return null;
}

export type ObjectiveCompletionGateResult = {
  status: ObjectiveCompletionStatus;
  /** True only when status === ""PROVEN"" — the only state that may finalize. */
  complete: boolean;
  /** True when the gate refuses finalization (NOT PROVEN or PARTIALLY PROVEN). */
  blocked: boolean;
  /** The declared objective's required claim ids (AI-OBJ-011). */
  requiredClaims: string[];
  /** Required claim ids the run actually closed with direct evidence (AI-OBJ-011). */
  completedClaims: string[];
  /** Objective claim ids that are still UNCLOSED. */
  missingClaims: string[];
  /** The declared objective's required edge keys (`from->to`) (AI-OBJ-011). */
  requiredEdges: string[];
  /** Required edge keys (`from->to`) that lack direct proof. */
  missingEdges: string[];
  /** Required edge keys that ARE directly proven at runtime. */
  provenEdges: string[];
  /** Objective claims whose answer text contradicts accepted source evidence. */
  contradictoryClaims: string[];
  /** Whether the candidate answer was a behavioral substitute (object kind) for
   *  a production-reachability objective (AI-OBJ-007/013-T6), when detected. */
  answerTypeMismatch: boolean;
  /** Whether recovery exceeded the bounded objective scope (AI-OBJ-009/013-T5). */
  recoveryScopeViolated: boolean;
  /** Human-readable reason for the verdict, usage bounded. */
  reasons: string[];
};

/**
 * AI-OBJ-005: the Objective Completion Gate. Runs BEFORE a final answer is
 * emitted and refuses finalization while any required claim or required evidence
 * edge is unproven. Import/package membership can never satisfy an edge — only a
 * directly proven, runtime-observed edge carried in `provenEdges` does.
 *
 * - PROVEN: every required claim and required edge is closed/proven.
 * - PARTIALLY_PROVEN: at least one required element is proven but not all.
 * - NOT_PROVEN: no required claim/edge is proven (nothing to sustain the objective).
 * - BLOCKED: the declared objective cannot be completed; combined with the
 *   caller's must-complete policy this fails closed and emits NO final answer.
 */
export function objectiveCompletionGate(input: {
  ledger: RunLedger;
  objective: {
    objectiveType: string;
    requiredClaims: readonly { claimId: string; text: string }[];
    requiredEvidenceEdges?: readonly ObjectiveEvidenceEdgeRef[];
  };
  /** Directly proven reachability edges from this run (runtime/evidence proof only). */
  provenEdges?: readonly { from?: string; to?: string }[];
  /**
   * Claim ids already closed by the run (e.g. via closeObjectiveClaimsFromEdges).
   * Falls back to any PROVEN/SUPPORTED ledger claim when not supplied.
   */
  closedClaimIds?: readonly string[];
  /**
   * AI-OBJ-009/013-T5: true when recovery reads stepped outside the bounded
   * objective scope (non-required files) while closing a missing edge/symbol.
   * Enforced fail-closed: an over-broad recovery scan can never finalize the
   * objective, even if some evidence was collected.
   */
  recoveryScopeViolated?: boolean;
  /**
   * AI-OBJ-007/013-T6: true when the candidate answer is a behavioral
   * explanation of the target rather than a production-reachability proof.
   * A behavioral excerpt can never satisfy a reachability claim.
   */
  answerTypeMismatch?: boolean;
  /** Server-owned contradiction findings; any one blocks finalization. */
  contradictoryClaimIds?: readonly string[];
}): ObjectiveCompletionGateResult {
  const { ledger, objective } = input;
  const provenEdgeKeys = new Set(
    (input.provenEdges ?? [])
      .filter((e) => e.from && e.to)
      .map((e) => `${e.from}->${e.to}`),
  );
  // Claim closure: prefer explicit closedClaimIds, else use ledger claims that
  // reached SUPPORTED with a matching objective-scoped claimId.
  const suppliedClosed = new Set(input.closedClaimIds ?? []);
  const contradictoryClaims = [...new Set(input.contradictoryClaimIds ?? [])]
    .filter((claimId) => objective.requiredClaims.some((claim) => claim.claimId === claimId));

  const missingClaims = objective.requiredClaims
    .filter((rc) => {
      const objectiveId = `objective:${rc.claimId}`;
      if (suppliedClosed.has(rc.claimId) || suppliedClosed.has(objectiveId)) return false;
      if (ledger.claims.some((c) => c.claimId === objectiveId && c.status === ""SUPPORTED"")) {
        return false;
      }
      return true;
    })
    .map((rc) => rc.claimId);

  const requiredEdgeKeys = (objective.requiredEvidenceEdges ?? []).map(
    (e) => `${e.from}->${e.to}`,
  );
  const missingEdges = requiredEdgeKeys.filter((k) => !provenEdgeKeys.has(k));
  const provenEdges = requiredEdgeKeys.filter((k) => provenEdgeKeys.has(k));

  const allClosed = missingClaims.length === 0 && missingEdges.length === 0;
  // ""Any proven"" means at least ONE required element — a required claim closed
  // OR a required edge directly proven — is actually demonstrated. A closed
  // claim is itself proof, so it counts here, not merely ledger.provenClaims.
  const closedRequiredClaimCount = objective.requiredClaims.length - missingClaims.length;
  const anyProven = provenEdges.length > 0 || closedRequiredClaimCount > 0;
  const hasEvidence = ledger.evidenceRecords.length > 0 || ledger.claims.length > 0;

  const completedClaims = objective.requiredClaims
    .map((rc) => rc.claimId)
    .filter((id) => !missingClaims.includes(id));

  const reasons: string[] = [];

  // Fail-closed precedence (AI-OBJ-013): the two scope/object-kind failures
  // override every evidence-quality verdict. Even a fully-evidenced objective
  // is refused if the model answered behaviorally (T6) or recovery over-read the
  // bounded scope (T5) — no amount of collected evidence repairs those.
  let status: ObjectiveCompletionStatus;
  if (input.answerTypeMismatch) {
    status = ""OBJECTIVE_MISMATCH"";
  } else if (input.recoveryScopeViolated) {
    status = ""RECOVERY_SCOPE_FAILURE"";
  } else if (contradictoryClaims.length > 0) {
    status = ""BLOCKED"";
  } else if (allClosed && !hasEvidence) {
    status = ""NOT_PROVEN"";
  } else if (allClosed) {
    status = ""PROVEN"";
  } else if (anyProven) {
    status = ""PARTIALLY_PROVEN"";
  } else {
    status = hasEvidence ? ""BLOCKED"" : ""NOT_PROVEN"";
  }

  if (input.answerTypeMismatch) {
    reasons.push(
      ""answer is a behavioral explanation of the target, not a production-reachability proof (AI-OBJ-007)"",
    );
  }
  if (input.recoveryScopeViolated) {
    reasons.push(
      ""recovery reads escaped the bounded objective scope; unjustified broad scan (AI-OBJ-009)"",
    );
  }
  if (contradictoryClaims.length) {
    reasons.push(
      `accepted evidence contradicts answer conclusions for: ${contradictoryClaims.join("", "")}`,
    );
  }
  if (missingClaims.length) reasons.push(`unclosed required claims: ${missingClaims.join("", "")}`);
  if (missingEdges.length) reasons.push(`proved edges missing: ${missingEdges.join("", "")}`);

  return {
    status,
    complete: status === ""PROVEN"",
    blocked: status !== ""PROVEN"",
    requiredClaims: objective.requiredClaims.map((rc) => rc.claimId),
    completedClaims,
    missingClaims,
    requiredEdges: requiredEdgeKeys,
    missingEdges,
    provenEdges,
    contradictoryClaims,
    answerTypeMismatch: Boolean(input.answerTypeMismatch),
    recoveryScopeViolated: Boolean(input.recoveryScopeViolated),
    reasons: reasons.slice(0, 6),
  };
}

export type FinalAnswerValidation = {
  verdict: ObjectiveVerdictKind;
  /**
   * Zero-length when verdict is ANSWER_COMPLETE; populated with structured
   * rule-violation strings (R1:…R6:) for every other verdict.
   */
  violations: string[];
};

/**
 * AI-OBJ-007: gate that rejects evidence before it enters claim validation if
 * the evidence does not prove the category of claim it is attached to.
 *
 * Rules enforced structurally (not via prompt):
 *  R0. C_PRODUCTION_REACHABILITY is fail-closed on missing snippet: an absent
 *      excerpt cannot prove that a caller reaches a target.
 *  R1. A CONTEXT_ONLY record can prove only C_STRUCTURAL.
 *  R2. A behavioral excerpt (pure algorithm body) cannot prove
 *      C_PRODUCTION_REACHABILITY.
 *  R3. Import / package-membership evidence cannot prove
 *      C_PRODUCTION_REACHABILITY.
 *  R4. For C_PRODUCTION_REACHABILITY + a non-empty snippet: the snippet must
 *      contain a positive invocation/data-flow pattern (allowlist). A snippet
 *      that avoids the behavioral/import denylists but contains no call-site is
 *      still rejected — ambiguous evidence cannot prove a caller reaches a
 *      target.
 *  R5. When `opts.targetSymbol` is provided the allowlist invocation must
 *      reference that specific symbol, not just any function. This prevents
 *      generic call-sites (e.g. `new Map()`) from satisfying a claim about
 *      `computeCentrality`.
 *  R6. A declaration is NOT a call-site. A function/class/object-shorthand
 *      method that *defines* the target (`computeCentrality(graph) {`, 
 *      `export function computeCentrality(`, `const f = (g) => …`) proves where
 *      the symbol is defined, not that it is invoked from a caller. Such excerpts
 *      are rejected for C_PRODUCTION_REACHABILITY even when they lexically
 *      contain `symbol(`, because R5 alone would wrongly read the method name
 *      as an invocation.
 *
 * `snippet` is the human-readable excerpt extracted from the source window
 * (the same text that appears in an EvidenceReference.excerpt).
 * Pass `opts.targetSymbol` (from `claim.symbol`) to enable symbol-specific
 * validation (R5).
 */
export function evidenceRelevanceGate(
  record: Pick<EvidenceRecord, ""strength"" | ""file"">,
  claimCategory: ClaimCategory,
  snippet = """",
  opts?: { targetSymbol?: string },
): EvidenceRelevanceVerdict {
  // Rule 1: CONTEXT_ONLY strength cannot prove behavioral / reachability / finding claims.
  if (record.strength === ""CONTEXT_ONLY"" && claimCategory !== ""C_STRUCTURAL"") {
    return {
      relevant: false,
      code: ""RELEVANCE_MISMATCH"",
      reason: `CONTEXT_ONLY evidence from ${record.file} cannot prove ${claimCategory} (AI-OBJ-007 R1)`,
    };
  }

  if (claimCategory === ""C_PRODUCTION_REACHABILITY"") {
    // Rule 0: fail-closed — absent snippet cannot prove a call-site relationship.
    if (!snippet) {
      return {
        relevant: false,
        code: ""RELEVANCE_MISMATCH"",
        reason:
          `no source excerpt was provided for ${record.file}; ` +
          `C_PRODUCTION_REACHABILITY requires a call-site snippet to prove that a caller ` +
          `actually invokes the target (AI-OBJ-007 R0)`,
      };
    }
    // Rule 6: a declaration is not a call-site. This is checked first so that a
    // definition of the target (method shorthand, class method, function
    // declaration, arrow assignment) is never treated as invocation evidence —
    // R5's `symbol(` match alone would otherwise accept the method name.
    const declarationGuard = DECLARATION_PATTERNS.find((re) => re.test(snippet));
    if (declarationGuard) {
      return {
        relevant: false,
        code: ""RELEVANCE_MISMATCH"",
        reason:
          `snippet from ${record.file} is a symbol declaration (${declarationGuard.source} match), ` +
          `not a call-site — a definition proves where the target lives, not that a caller ` +
          `invokes it, and cannot prove C_PRODUCTION_REACHABILITY (AI-OBJ-007 R6)`,
      };
    }
    // Rule 2: behavioral computation excerpts cannot prove reachability.
    // Exception: if the snippet also matches an INVOCATION_PATTERNS entry, the
    // snippet is a call-site — the function name may contain a behavioral keyword
    // (e.g. `computeCentrality`), but the line itself is an invocation, not a
    // description. Invocation evidence wins over the behavioral denylist.
    const snippetIsInvocation = INVOCATION_PATTERNS.some((re) => re.test(snippet));
    if (!snippetIsInvocation && BEHAVIORAL_PATTERNS.some((re) => re.test(snippet))) {
      return {
        relevant: false,
        code: ""RELEVANCE_MISMATCH"",
        reason:
          `behavioral excerpt from ${record.file} proves C_BEHAVIOR, not C_PRODUCTION_REACHABILITY — ` +
          `a call-site or data-flow span is required (AI-OBJ-007 R2)`,
      };
    }
    // Rule 3: import / package-membership evidence cannot prove reachability.
    if (IMPORT_MEMBERSHIP_PATTERNS.some((re) => re.test(snippet))) {
      return {
        relevant: false,
        code: ""RELEVANCE_MISMATCH"",
        reason:
          `import / package-membership excerpt from ${record.file} proves C_STRUCTURAL, ` +
          `not C_PRODUCTION_REACHABILITY — an invocation span is required (AI-OBJ-007 R3)`,
      };
    }
    // Rule 4: positive-evidence gate — the snippet must contain a recognisable
    // call-site or data-flow pattern.
    if (!INVOCATION_PATTERNS.some((re) => re.test(snippet))) {
      return {
        relevant: false,
        code: ""RELEVANCE_MISMATCH"",
        reason:
          `snippet from ${record.file} contains no recognisable invocation or data-flow pattern; ` +
          `a call-site excerpt (e.g. ""return computeCentrality(graph, opts)"") is required ` +
          `to prove C_PRODUCTION_REACHABILITY (AI-OBJ-007 R4)`,
      };
    }
    // Rule 5: symbol-specific invocation — when the target symbol is known the
    // snippet must contain an invocation of THAT symbol, not just any function.
    // This prevents generic call-sites (new Map(), fs.readFile(), etc.) from
    // satisfying a claim about a specific target.
    if (opts?.targetSymbol) {
      const symbolInvocationRe = new RegExp(`\\b${escapeRegExp(opts.targetSymbol)}\\s*\\(`);
      if (!symbolInvocationRe.test(snippet)) {
        return {
          relevant: false,
          code: ""RELEVANCE_MISMATCH"",
          reason:
            `snippet from ${record.file} contains no invocation of target symbol ""${opts.targetSymbol}""; ` +
            `generic call-sites do not prove that a specific caller reaches this target (AI-OBJ-007 R5)`,
        };
      }
    }
  }

  return { relevant: true };
}

/**
 * Heuristic patterns that indicate a window is purely behavioral (describes what
 * a function *does*) rather than where it is *called from* in production.
 */
const BEHAVIORAL_PATTERNS: readonly RegExp[] = [
  // Algorithm / computation body patterns
  /\b(?:totalDegree|inDegree|outDegree|pageRank|betweenness|closeness)\b/,
  /\b(?:centrality|clustering|coefficient|eigenvector)\b/i,
  // Pure arithmetic expression (e.g. `= inDegree + outDegree`)
  /return\s+\w+\s*[+\-*/]\s*\w+/,
  // ""Describes behaviour"" narrative prose inside a code snippet
  /\/\/\s*(?:returns|computes|calculates|iterates|accumulates)\b/i,
];

export type EvidenceRelevanceVerdict =
  | { relevant: true }
  | { relevant: false; code: ""RELEVANCE_MISMATCH""; reason: string };

/**
 * Heuristic patterns that indicate import / package membership rather than an
 * invocation or data-flow.
 */
const IMPORT_MEMBERSHIP_PATTERNS: readonly RegExp[] = [
  /^\s*import\s+/m,
  /^\s*from\s+['""][^'""]+['""]\s*import\b/m,
  /\brequire\s*\(\s*['""][^'""]+['""]\s*\)/,
  /^\s*export\s*\{[^}]*\}\s*from\b/m,
  // package.json / tsconfig membership
  /[""']dependencies[""']/,
  /[""']peerDependencies[""']/,
];

/**
 * Positive invocation / data-flow patterns required for a snippet to prove
 * C_PRODUCTION_REACHABILITY. A snippet provided for a reachability claim must
 * contain at least ONE of these to be accepted — absence of behavioral patterns
 * is not sufficient; the snippet must positively demonstrate a call site or
 * data-flow relationship (AI-OBJ-007 R4 — positive-evidence gate).
 *
 * Patterns:
 *  - Method call:         `.methodName(`
 *  - Assignment from call:`= identifier(`
 *  - return invocation:   `return identifier(`
 *  - await invocation:    `await identifier`
 *  - Constructor call:    `new UpperCase(`
 *  - Pipe / then:         `.pipe(` / `.then(`
 */
const INVOCATION_PATTERNS: readonly RegExp[] = [
  /\.\w+\s*\(/,                       // .methodName(
  /=\s*[a-zA-Z_]\w*\s*\(/,           // = someFunc(
  /\breturn\s+[a-zA-Z_]\w*\s*\(/,    // return someFunc(
  /\bawait\s+[a-zA-Z_]\w*/,          // await someFunc
  /\bnew\s+[A-Z][a-zA-Z0-9_]*\s*\(/, // new ClassName(
  /\.(?:pipe|then|call|apply)\s*\(/,  // .pipe( / .then( / .call( / .apply(
  /^\s*[a-zA-Z_]\w*\s*\(/,           // standalone call at line start: computeCentrality(
];

/**
 * Declaration forms that must NOT be read as invocation evidence
 * (AI-OBJ-007 R6). A pattern here indicates the snippet *defines* a symbol
 * rather than calling it. Detection is structural so a method named like the
 * target (`computeCentrality(graph) { … }`, class shorthand, arrow assignment)
 * can never satisfy R5 on its own.
 */
const DECLARATION_PATTERNS: readonly RegExp[] = [
  // Named function declaration: `function foo(`, `export function foo(`,
  // `export default function foo(`, `async function foo(`
  /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+/,
  // Function expression-ish arrow assignment: `const foo = (…)=>` / `… = (…)=>`
  /=\s*(?:async\s+)?\([^=]*?\)\s*=>/,
  /=\s*(?:async\s+)?\w+\s*=>/,
  // Class declaration
  /^\s*(?:export\s+)?(?:default\s+)?class\s+\w+/,
  // Class method shorthand:  `fooBar(…) {` at line start (also covers object
  // literal shorthand methods and getters/setters). Anchored so a standalone
  // call-line like `computeCentrality(graph, …);` is NOT rejected.
  /^\s*(?:(?:async|get|set)\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*:/, // `name(args): Type` after param close
  /^\s*(?:(?:async|get|set)\s+)?[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/, // `name(args) {`
  // `constructor(…)` / class-constructor style
  /^\s*constructor\s*\(/,
];
/** Escape a string for use in a RegExp so symbol names with special chars are safe. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, ""\\$&"");
}

/**
 * AI-OBJ-010: validate a final answer against 6 structural rules before it is
 * emitted. Returns ANSWER_COMPLETE only when every rule passes.
 *
 * Rules:
 *  1. Core question must be answered (primary claim closed).
 *  2. Every core claim must have at least one PROVEN validation.
 *  3. No behavioral evidence may substitute for the primary objective when the
 *     claim category is C_PRODUCTION_REACHABILITY.
 *  4. NOT_PROVEN is only acceptable when a reachability edge genuinely lacks a
 *     source span — it must not be used as a blanket investigation failure.
 *  5. No fabricated Findings: every Finding claim needs a real source-span binding.
 *  6. Production reachability must not be proven by import or package membership
 *     alone (structural check on the ReachabilityProof summary when provided).
 */
export function validateFinalAnswer(input: {
  /** Whether the run's primary claim was closed by grounded evidence. */
  primaryClaimClosed: boolean;
  /** All claim validations from the final run ledger. */
  validations: readonly ClaimValidation[];
  /** Claims from the final run ledger. */
  claims: readonly ClaimRecord[];
  /**
   * The category of the primary claim. When C_PRODUCTION_REACHABILITY, evidence
   * that is purely behavioral is rejected by rule 3.
   */
  primaryClaimCategory?: ClaimCategory;
  /**
   * Behavioral evidence snippets that were actually used to close the primary claim.
   * Rule 3 inspects these when primaryClaimCategory is C_PRODUCTION_REACHABILITY.
   */
  primaryClaimEvidence?: Array<{ snippet: string; file: string; strength: EvidenceStrength }>;
  /**
   * When the run included reachability edges, pass the summary so rules 4 and 6
   * can check for import-only proof and blanket NOT_PROVEN misuse.
   */
  reachabilityProofStatus?: ""PROVEN"" | ""PARTIALLY_PROVEN"" | ""NOT_PROVEN"" | ""NO_EDGES"";
  hasImportOnlyHops?: boolean;
  recoveryAvailable?: boolean;
}): FinalAnswerValidation {
  const violations: string[] = [];

  // Rule 1: primary claim must be closed.
  if (!input.primaryClaimClosed) {
    violations.push(
      ""R1: core question is unanswered — the primary claim was not closed by any grounded source excerpt (AI-OBJ-010 R1)"",
    );
  }

  // Rule 2a: every supplied validation must be PROVEN.
  const unprovenValidations = input.validations.filter((v) => v.result !== ""PROVEN"");
  if (unprovenValidations.length > 0) {
    violations.push(
      `R2: ${unprovenValidations.length} validation(s) are not PROVEN: ` +
        unprovenValidations
          .slice(0, 3)
          .map((v) => `${v.claimId}=${v.result}`)
          .join("", "") +
        "" (AI-OBJ-010 R2)"",
    );
  }

  // Rule 2b: one-to-one correspondence — every supplied claim must have a
  // matching PROVEN validation by claimId. A PROVEN validation for a different
  // claim cannot prove an unvalidated claim.
  const nonFindingClaims = input.claims.filter(
    (c) =>
      !c.taskType.toLowerCase().includes(""finding"") &&
      !c.claimId.toLowerCase().includes(""finding""),
  );
  for (const claim of nonFindingClaims) {
    const validation = input.validations.find((v) => v.claimId === claim.claimId);
    if (!validation || validation.result !== ""PROVEN"") {
      violations.push(
        `R2-BINDING: claim ${claim.claimId} has no corresponding PROVEN validation ` +
          `(found: ${validation?.result ?? ""NONE""}) — every supplied claim must be individually proven (AI-OBJ-010 R2)`,
      );
    }
  }

  // Rule 3: behavioral evidence must not substitute for primary reachability objective.
  if (
    input.primaryClaimCategory === ""C_PRODUCTION_REACHABILITY"" &&
    input.primaryClaimEvidence?.length
  ) {
    for (const ev of input.primaryClaimEvidence) {
      const gate = evidenceRelevanceGate(
        { strength: ev.strength, file: ev.file },
        ""C_PRODUCTION_REACHABILITY"",
        ev.snippet,
      );
      if (!gate.relevant) {
        violations.push(`R3: ${gate.reason} (AI-OBJ-010 R3)`);
        break; // one violation is enough to flag the rule
      }
    }
  }

  // Rule 4: NOT_PROVEN must not be a blanket failure label when reachability edges exist.
  // A chain that has import-only hops but no genuinely unproven invocation edges is
  // actually an incomplete investigation, not a ""the answer is NOT_PROVEN"" verdict.
  if (
    input.reachabilityProofStatus === ""NOT_PROVEN"" &&
    input.hasImportOnlyHops &&
    input.primaryClaimCategory === ""C_PRODUCTION_REACHABILITY""
  ) {
    violations.push(
      ""R4: NOT_PROVEN must not be used as a blanket verdict when all edges are import-only; "" +
        ""these hops prove package membership, not production reachability — report OBJECTIVE_BLOCKED instead (AI-OBJ-010 R4)"",
    );
  }

  // Rule 5: no fabricated Findings — every Finding claim needs at least one source-span binding.
  const findingClaims = input.claims.filter((c) =>
    c.taskType.toLowerCase().includes(""finding"") || c.claimId.toLowerCase().includes(""finding""),
  );
  for (const fc of findingClaims) {
    if (!fc.binding || fc.binding.sourceSpans.length === 0) {
      violations.push(
        `R5: Finding claim ${fc.claimId} has no source-span binding — fabricated Findings are rejected (AI-OBJ-010 R5)`,
      );
    }
  }

  // Rule 6: production reachability must not be proven by import / package membership alone.
  if (
    input.primaryClaimCategory === ""C_PRODUCTION_REACHABILITY"" &&
    input.hasImportOnlyHops &&
    input.reachabilityProofStatus === ""PROVEN""
  ) {
    violations.push(
      ""R6: production reachability is marked PROVEN but the chain contains IMPORT_ONLY hops; "" +
        ""imports prove accessibility, not execution — this proof is rejected (AI-OBJ-010 R6)"",
    );
  }

  // Positive-proof completeness gate (AI-OBJ-010 R-PROOF):
  // ANSWER_COMPLETE must not be derived from absent proof data. The
  // `primaryClaimClosed` flag is a caller-supplied hint that cannot stand
  // alone — the validator must see at least one of:
  //   (a) a PROVEN claim validation from the run's reachability-specific claims, OR
  //   (b) an explicit PROVEN reachabilityProofStatus without import-only hops
  //       (externally validated trace, e.g. runtimeObserved links).
  //
  // In the chat-agent path, `validations` contains only reachability-specific
  // claim validations (not arbitrary behavioral validations), so condition (a)
  // is structurally tied to the reachability claim model — not to any unrelated
  // proof. Each of those validations passed the evidenceRelevanceGate (R2/R3/R5),
  // so a PROVEN source-backed call-site validation is genuine proof and suffices
  // on its own. For non-reachability tasks the same OR gate applies; either
  // evidence type suffices.
  const hasProvenValidation = input.validations.some((v) => v.result === ""PROVEN"");
  const hasExplicitReachabilityProof =
    input.reachabilityProofStatus === ""PROVEN"" && !input.hasImportOnlyHops;
  // R-PROOF fails when NEITHER condition is met.
  if (!hasProvenValidation && !hasExplicitReachabilityProof) {
    violations.push(
      ""R-PROOF: no positive proof found — ANSWER_COMPLETE requires either a PROVEN "" +
        ""claim validation (from source-backed reachability claims) OR an explicit PROVEN "" +
        ""reachabilityProofStatus without import-only hops; "" +
        ""primaryClaimClosed alone is insufficient (AI-OBJ-010 R-PROOF)"",
    );
  }

  if (violations.length === 0) {
    return { verdict: ""ANSWER_COMPLETE"", violations: [] };
  }

  // Map violations to the most precise ObjectiveVerdictKind.
  //
  // R1 / R3 / R4 / R6 → the primary objective or claim chain is structurally
  // blocked regardless of partial progress.
  //
  // R-PROOF is intentionally excluded from objectiveBlocked: failing R-PROOF
  // means the positive-proof bar for ANSWER_COMPLETE wasn't met, but it does
  // NOT force OBJECTIVE_BLOCKED when some claims are individually proven
  // (anyProven → ANSWER_PARTIAL is more accurate). ANSWER_COMPLETE is still
  // guarded by the violations.length === 0 check above.
  const objectiveBlocked = violations.some(
    (v) =>
      v.startsWith(""R1:"") ||
      v.startsWith(""R3:"") ||
      v.startsWith(""R4:"") ||
      v.startsWith(""R6:""),
  );
  // R2 with a partial claim proof → ANSWER_PARTIAL.
  const anyProven = input.validations.some((v) => v.result === ""PROVEN"");
  // No evidence at all: zero validations and no reachability proof.
  const noEvidence = input.validations.length === 0 && !hasExplicitReachabilityProof && !input.primaryClaimClosed;

  let verdict: ObjectiveVerdictKind;
  if (noEvidence) {
    verdict = ""EVIDENCE_INSUFFICIENT"";
  } else if (objectiveBlocked) {
    verdict = input.recoveryAvailable ? ""RECOVERY_REQUIRED"" : ""OBJECTIVE_BLOCKED"";
  } else if (anyProven) {
    verdict = ""ANSWER_PARTIAL"";
  } else {
    verdict = ""OBJECTIVE_BLOCKED"";
  }

  return { verdict, violations };
}

```",2026-09-19T21:01:34.550Z
1df90855-0dd8-40b9-b35d-1590968bcb41,8e78c54c-23e5-445e-85ec-6e3816154184,lib/ai-orchestrator/src/project-query-target.ts,source,,,fa848eca8e0b61064cacbcef4d398ddb2d601faa1cb9f2073e7a57435940ea6c,27584,1,0,"File: lib/ai-orchestrator/src/project-query-target.ts
```
import type { ObjectiveContract } from ""./schemas/chat.schema.js"";
import {
  isGapAnalysisRequest,
  type EvidenceReference,
} from ""./task-contracts.js"";

export type ProjectQueryTargetId = ""embedded-ai"" | ""gap-analysis"";
export type ProjectQueryTargetResolution =
  | ""resolved""
  | ""unresolved""
  | ""not_applicable"";

export type ProjectQueryTargetMode =
  | ""resolved_target""
  | ""bounded_unresolved_hint""
  | ""source_first_discovery"";
export type ProjectQueryTarget = {
  id: ProjectQueryTargetId;
  label: string;
  confidence: number;
  firstEvidencePath: string;
  primaryPaths: string[];
  allowedExpansionPaths: string[];
  forbiddenPaths: string[];
  requiredEvidencePaths: string[];
  requiredClaims: Array<{
    claimId: string;
    text: string;
    requiredEvidencePaths: string[];
    evidenceNeedles?: string[];
    evidenceNeedlesByPath?: Record<string, string[]>;
  }>;
  promptHint: string;
};

const SESSION_QUALITY_LATEST_RE =
  /(?:\b(?:latest|most\s+recent)(?:[-\s]+\w+){0,3}\s+session\b|آخر\s+(?:جلسة|جلسه)|الجلسة\s+(?:الأخيرة|الاخيرة))/iu;
const SESSION_QUALITY_AGENT_RE =
  /(?:\b(?:internal|embedded)\s+(?:AI\s+)?agent\b|\bproject[-\s]agent\b|\bagent\s+(?:of|inside)\s+the\s+project\b|الوكيل\s+(?:الداخلي|الداخلى)\s+(?:للمشروع|داخل\s+المشروع)|وكيل\s+المشروع)/iu;
const SESSION_QUALITY_DIMENSIONS_RE =
  /(?:\b(?:response|answer)\s+quality\b|\bquality\s+of\s+(?:the\s+)?responses?\b|\bconsistency\b|\bconsistent\b|\broot\s+cause\b|\bdivergence\b|\bdeviation\b|جودة\s+(?:الردود|الإجابات)|مستوى\s+(?:الردود|الإجابات)|اتساق(?:ها|هما|الردود|الإجابات)?|السبب\s+الجذري|الانحراف|الانحرافات)/iu;
const SESSION_QUALITY_DIVERGENCE_RE =
  /(?:\broot\s+cause\b|\bdivergence\b|\bdeviation\b|السبب\s+الجذري|الانحراف|الانحرافات)/iu;
const SESSION_QUALITY_TRACE_RE =
  /(?:\b(?:trace|track|follow)\s+(?:the\s+)?(?:path|flow)\b|تتبع\s+مسار|تتبّع\s+مسار)/iu;
const ACCEPTANCE_COVERAGE_REQUEST_RE =
  /(?:\bacceptance\b[\s\S]{0,180}\b(?:coverage|all|each|every|task\s+(?:type|family|families)|objective|validator|success\s+criteria)\b|\b(?:all|each|every)\s+task\s+(?:types?|famil(?:y|ies))\b[\s\S]{0,180}\b(?:acceptance|objective|validator|success\s+criteria)\b|(?:تغطية\s+(?:شاملة|كاملة)|كل\s+نوع\s+مهمة|جميع\s+أنواع\s+المهام)[\s\S]{0,240}(?:acceptance|objective|validator|معايير|نجاح))/iu;

/**
 * A request that inventories several task families is a meta-level acceptance
 * contract request. It must not become a subsystem query merely because the
 * inventory contains words such as ""provider"", ""analysis"", or ""file
 * conversion"".
 */
export function isAcceptanceCoverageRequest(message: string): boolean {
  return ACCEPTANCE_COVERAGE_REQUEST_RE.test(message);
}

/**
 * This is intentionally narrower than a generic session question. It requires
 * a latest-session binding, an embedded project-agent reference, and an
 * explicit quality/consistency deliverable. Generic questions about sessions
 * remain ordinary project queries or chat.
 */
export function isSessionQualityAuditRequest(message: string): boolean {
  const latestSession = SESSION_QUALITY_LATEST_RE.test(message);
  const qualityAudit =
    SESSION_QUALITY_AGENT_RE.test(message)
    && SESSION_QUALITY_DIMENSIONS_RE.test(message);
  const divergenceAudit =
    SESSION_QUALITY_TRACE_RE.test(message)
    && SESSION_QUALITY_DIVERGENCE_RE.test(message);
  return latestSession && (qualityAudit || divergenceAudit);
}

/**
 * These are deliberately limited to direct calls made by the production
 * `chat()` orchestrator. The retained-read edge verifier binds each edge to
 * that caller's AST body; imports and same-file symbol co-occurrence cannot
 * close this contract.
 */
const EMBEDDED_AI_EXECUTION_EDGES = [
  {
    from: ""lib/ai-orchestrator/src/agents/chat-agent.ts#chat"",
    to: ""lib/ai-orchestrator/src/turn-intent.ts#resolveTurnIntent"",
    relationship: ""DIRECT_INVOCATION"",
  },
  {
    from: ""lib/ai-orchestrator/src/agents/chat-agent.ts#chat"",
    to: ""lib/ai-orchestrator/src/tool-execution-engine.ts#executeToolLoop"",
    relationship: ""DIRECT_INVOCATION"",
  },
  {
    from: ""lib/ai-orchestrator/src/agents/chat-agent.ts#chat"",
    to: ""lib/ai-orchestrator/src/provider-strategy.ts#call"",
    relationship: ""DIRECT_INVOCATION"",
  },
  {
    from: ""lib/ai-orchestrator/src/agents/chat-agent.ts#chat"",
    to: ""lib/ai-orchestrator/src/provider-strategy.ts#stream"",
    relationship: ""DIRECT_INVOCATION"",
  },
  {
    from: ""lib/ai-orchestrator/src/agents/chat-agent.ts#chat"",
    to: ""lib/ai-orchestrator/src/agents/chat-agent.ts#finalizeObjectiveAndStream"",
    relationship: ""DIRECT_INVOCATION"",
  },
  {
    from: ""lib/ai-orchestrator/src/agents/chat-agent.ts#chat"",
    to: ""lib/ai-orchestrator/src/evidence-integrity.ts#validateFinalAnswer"",
    relationship: ""DIRECT_INVOCATION"",
  },
] as const;

const EMBEDDED_AI_TARGET: Omit<ProjectQueryTarget, ""confidence""> = {
  id: ""embedded-ai"",
  label: ""embedded AI layer"",
  firstEvidencePath: ""artifacts/api-server/src/routes/ai/chat.ts"",
  primaryPaths: [
    ""artifacts/api-server/src/routes/ai/chat.ts"",
    ""artifacts/api-server/src/lib/ai-execution-state.ts"",
    ""artifacts/api-server/src/lib/ai-execution-acceptance.ts"",
    ""lib/ai-orchestrator/src/turn-intent.ts"",
    ""lib/ai-orchestrator/src/agents/chat-agent.ts"",
  ],
  allowedExpansionPaths: [
    ""lib/ai-orchestrator/src"",
    ""lib/db/src/schema"",
    ""artifacts/api-server/src/routes/ai"",
    ""artifacts/api-server/src/lib"",
  ],
  forbiddenPaths: [
    ""node_modules"",
    ""dist"",
    ""build"",
  ],
  requiredEvidencePaths: [
    ""artifacts/api-server/src/routes/ai/chat.ts"",
    ""lib/ai-orchestrator/src/turn-intent.ts"",
    ""lib/ai-orchestrator/src/agents/chat-agent.ts"",
  ],
  requiredClaims: [
    {
      claimId: ""ai-routing"",
      text: ""The chat route resolves the turn intent before selecting the execution path."",
      requiredEvidencePaths: [
        ""artifacts/api-server/src/routes/ai/chat.ts"",
        ""lib/ai-orchestrator/src/turn-intent.ts"",
      ],
      evidenceNeedles: [""resolveTurnIntent"", ""turnIntent""],
    },
    {
      claimId: ""ai-tool-loop"",
      text: ""The tool-enabled chat execution enters executeToolLoop and retains its tool results before synthesis."",
      requiredEvidencePaths: [
        ""lib/ai-orchestrator/src/agents/chat-agent.ts"",
      ],
      evidenceNeedles: [""executeToolLoop"", ""loopResult""],
    },
    {
      claimId: ""ai-provider-dispatch"",
      text: ""The route dispatches provider requests through chatWithFallback before final response validation."",
      requiredEvidencePaths: [
        ""artifacts/api-server/src/routes/ai/chat.ts"",
      ],
      evidenceNeedles: [""chatWithFallback"", ""provider""],
    },
  ],
  promptHint:
    ""Targeted project analysis: analyze the embedded AI layer end to end. "" +
    ""Read and explicitly cover the server-owned behavioral claims for routing, the tool loop, "" +
    ""provider dispatch, and acceptance with their source paths before synthesizing. "" +
    ""Prove the retained production execution edges for intent routing, tool execution, "" +
    ""provider dispatch, synthesis/finalization, and final validation before calling the answer proven. "" +
    ""State each claim assertion verbatim, then explain the sequence in the requested language. "" +
    ""If the goal asks for weaknesses, also state the verified weakness claim about "" +
    ""finish_reason=\""error\"" and explain why it must be rejected before tool execution. "" +
    ""Separate verified weakness evidence from hypotheses. Do not stop at a symbol inventory, "" +
    ""one provider client, or a generic project-access explanation."",
};

const EMBEDDED_AI_WEAKNESS_CLAIM = {
  claimId: ""ai-weakness-analysis"",
  text:
    'The provider boundary must reject finish_reason=""error"" before tool execution; ' +
    ""otherwise content or tool calls can make an error-shaped response look successful."",
  requiredEvidencePaths: [
    ""lib/ai-orchestrator/src/openai-compatible-client.ts"",
    ""lib/ai-orchestrator/src/tool-execution-engine.ts"",
  ],
  evidenceNeedlesByPath: {
    ""lib/ai-orchestrator/src/openai-compatible-client.ts"": [""finishReason""],
    ""lib/ai-orchestrator/src/tool-execution-engine.ts"": [""executeToolLoop""],
  },
};

const SESSION_QUALITY_CLAIMS: ProjectQueryTarget[""requiredClaims""] = [
  {
    claimId: ""ai-session-history-binding"",
    text:
      ""The latest-session quality audit is bound to a non-empty project-scoped chat session before history is loaded and does not fall back to a new blank session."",
    requiredEvidencePaths: [
      ""artifacts/api-server/src/routes/ai/chat.ts"",
    ],
    evidenceNeedles: [
      ""resolveLatestProjectChatSession"",
      ""historyRows"",
      ""sessionIdToUse"",
    ],
  },
  {
    claimId: ""ai-session-observed-path"",
    text:
      ""The persisted chat turn retains the observed message, intent, tool/evidence trace, execution identity, and terminal outcome as separate server-owned fields."",
    requiredEvidencePaths: [
      ""artifacts/api-server/src/routes/ai/chat.ts"",
      ""lib/db/src/schema/ai_chats.ts"",
    ],
    evidenceNeedlesByPath: {
      ""artifacts/api-server/src/routes/ai/chat.ts"": [
        ""toolTrace"",
        ""executionId"",
        ""outcome"",
      ],
      ""lib/db/src/schema/ai_chats.ts"": [
        ""toolTrace"",
        ""executionId"",
        ""outcome"",
      ],
    },
  },
  {
    claimId: ""ai-response-quality-validation"",
    text:
      ""Response quality and language/contract checks are server-owned and run before the turn is finalized."",
    requiredEvidencePaths: [
      ""lib/ai-orchestrator/src/task-contracts.ts"",
      ""lib/ai-orchestrator/src/agents/chat-agent.ts"",
    ],
    evidenceNeedlesByPath: {
      ""lib/ai-orchestrator/src/task-contracts.ts"": [
        ""validateResponseLanguage"",
        ""TaskValidationResult"",
      ],
      ""lib/ai-orchestrator/src/agents/chat-agent.ts"": [
        ""_qualityError"",
        ""validateFinalAnswer"",
      ],
    },
  },
  {
    claimId: ""ai-terminal-projection-parity"",
    text:
      ""Direct JSON, streamed SSE, persisted messages, and history reloads use the same server-owned session and terminal outcome identity."",
    requiredEvidencePaths: [
      ""artifacts/api-server/src/routes/ai/chat.ts"",
      ""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",
      ""lib/db/src/schema/ai_chats.ts"",
    ],
    evidenceNeedlesByPath: {
      ""artifacts/api-server/src/routes/ai/chat.ts"": [
        ""serializeAiSseEvent"",
        ""persistFailedChatTurn"",
        ""terminalProjection"",
      ],
      ""artifacts/api-server/src/lib/ai-terminal-outcome.ts"": [
        ""AiTerminalProjection"",
        ""outcome"",
      ],
      ""lib/db/src/schema/ai_chats.ts"": [
        ""sessionId"",
        ""outcome"",
        ""executionId"",
      ],
    },
  },
];

const SESSION_DIVERGENCE_CLAIMS: ProjectQueryTarget[""requiredClaims""] = [
  {
    claimId: ""ai-session-divergence-root-cause"",
    text:
      ""The first session divergence and its root cause are identified by comparing the server-owned intent, history/tool/evidence trace, execution identity, and terminal outcome; unsupported causal explanations remain hypotheses."",
    requiredEvidencePaths: [
      ""artifacts/api-server/src/routes/ai/chat.ts"",
      ""lib/ai-orchestrator/src/turn-intent.ts"",
      ""lib/ai-orchestrator/src/agents/chat-agent.ts"",
      ""lib/db/src/schema/ai_chats.ts"",
      ""artifacts/api-server/src/lib/ai-terminal-outcome.ts"",
    ],
    evidenceNeedlesByPath: {
      ""artifacts/api-server/src/routes/ai/chat.ts"": [
        ""resolvedTurnIntent"",
        ""analysisCorrelation"",
        ""sessionIdToUse"",
      ],
      ""lib/ai-orchestrator/src/turn-intent.ts"": [
        ""resolveTurnIntent"",
        ""TurnIntent"",
      ],
      ""lib/ai-orchestrator/src/agents/chat-agent.ts"": [
        ""executeToolLoop"",
        ""validateFinalAnswer"",
      ],
      ""lib/db/src/schema/ai_chats.ts"": [
        ""toolTrace"",
        ""executionId"",
        ""outcome"",
      ],
      ""artifacts/api-server/src/lib/ai-terminal-outcome.ts"": [
        ""AiTerminalProjection"",
        ""sessionId"",
        ""executionId"",
      ],
    },
  },
];

const SESSION_QUALITY_PROMPT_HINT =
  ""Targeted embedded-agent session-quality analysis: bind the audit to the latest non-empty "" +
  ""project-scoped session before reading its history. Explain the observed message, intent, "" +
  ""tool/evidence, execution, and terminal sequence separately from response-quality and "" +
  ""consistency findings. When divergence or root-cause tracing is requested, identify the "" +
  ""first server-observed divergence before proposing a cause. Compare direct JSON, streamed SSE, persisted message, and history "" +
  ""projections only from server-owned evidence. Keep verified observations, limitations, "" +
  ""and unverified hypotheses separate, and return ANALYSIS_INCOMPLETE when any required "" +
  ""session, quality, or projection claim is not proven. Use the requested language."";

const GAP_ANALYSIS_TARGET: Omit<ProjectQueryTarget, ""confidence""> = {
  id: ""gap-analysis"",
  label: ""verified project gaps"",
  firstEvidencePath: ""lib/ai-orchestrator/src/turn-intent.ts"",
  primaryPaths: [
    ""lib/ai-orchestrator/src/turn-intent.ts"",
    ""lib/ai-orchestrator/src/agents/query-planner.ts"",
    ""artifacts/api-server/src/routes/ai/chat.ts"",
    ""artifacts/api-server/src/lib/ai-execution-state.ts"",
  ],
  allowedExpansionPaths: [
    ""lib/ai-orchestrator/src"",
    ""artifacts/api-server/src/routes/ai"",
    ""artifacts/api-server/src/lib"",
  ],
  forbiddenPaths: [
    ""node_modules"",
    ""dist"",
    ""build"",
  ],
  requiredEvidencePaths: [
    ""lib/ai-orchestrator/src/turn-intent.ts"",
    ""lib/ai-orchestrator/src/agents/query-planner.ts"",
    ""artifacts/api-server/src/routes/ai/chat.ts"",
    ""artifacts/api-server/src/lib/ai-execution-state.ts"",
  ],
  requiredClaims: [
    {
      claimId: ""gap-routing"",
      text: ""resolveTurnIntent"",
      requiredEvidencePaths: [
        ""lib/ai-orchestrator/src/turn-intent.ts"",
      ],
    },
    {
      claimId: ""gap-planning"",
      text: ""inferCompoundParts"",
      requiredEvidencePaths: [
        ""lib/ai-orchestrator/src/agents/query-planner.ts"",
      ],
    },
    {
      claimId: ""gap-acceptance"",
      text: ""validateAnalysisEvidenceCompletion"",
      requiredEvidencePaths: [
        ""artifacts/api-server/src/routes/ai/chat.ts"",
        ""artifacts/api-server/src/lib/ai-execution-state.ts"",
      ],
    },
  ],
  promptHint:
    ""Targeted project gap analysis: identify only gaps supported by retained source evidence. "" +
    ""Read the routing, query-planning, and semantic-acceptance paths before synthesizing. "" +
    ""Separate verified gaps from unverified hypotheses and cite every gap to its source path."",
};

const BROAD_GAP_REQUEST_RE =
  /(?:\b(?:full|complete|comprehensive|entire|whole|repository|workspace|codebase|audit|review)\b|(?:تدقيق|دقق|شامل|بالكامل|كل\s+(?:المشروع|الكود)))/iu;

const AMBIGUOUS_PROJECT_SCOPE_RE =
  /(?:\b(?:project|workspace|repository|repo|codebase|system|architecture|module|service|component|layer|workflow|pipeline|flow|function|class|handler|endpoint|implementation|source|code)\b|مشروع|المشروع|المستودع|الريبو|قاعدة\s+(?:الكود|الشفرة|المصدر)|النظام|المعمارية|الهندسة|الوحدة|الخدمة|المكوّن|المكون|الطبقة|سير\s+العمل|التدفق|الدالة|الفئة|المعالج|النقطة|التنفيذ|المصدر|الكود|الشفرة)/iu;

const AMBIGUOUS_PROJECT_ANALYSIS_RE =
  /(?:\b(?:analy[sz]e|analysis|review|assess|explain|describe|understand|trace|investigate|how|why|what)\b|تحليل|حلل|حلّل|راجع|مراجعة|قيّم|قيم|اشرح|شرح|صف|افهم|فهم|تتبع|تحقيق|كيف|لماذا|ما(?:ذا)?|أين)/iu;

const PROJECT_ORIENTATION_RE =
  /^(?:ما(?:\s+هو)?\s+(?:اسم\s+)?(?:هذا\s+)?المشروع|ماذا\s+(?:يفعل|يقدم|يحتوي)\s+(?:هذا\s+)?المشروع|عن\s+ماذا\s+يدور\s+(?:هذا\s+)?المشروع|[اأ]شرح(?:\s+لي)?\s+(?:هذا\s+)?المشروع(?:\s+(?:بصورة\s+)?(?:مبسطة|ببساطة))?|ساعدني(?:\s+في)?\s+(?:فهم|أفهم)(?:\s+هذا)?\s+المشروع|ممكن\s+تساعدني(?:\s+أن)?\s+(?:أفهم\s+)?المشروع|هل\s+(?:هذا\s+)?المشروع\s+(?:شغال|يعمل)(?:\s+حاليًا)?|what(?:'s| is)\s+(?:the\s+)?(?:this\s+)?project(?:'s\s+name|\s+status)?|what\s+does\s+(?:this\s+)?project\s+do|(?:explain|describe)\s+(?:this\s+)?project|help\s+me\s+understand\s+(?:this\s+)?project|is\s+(?:this\s+)?project\s+running|(?:ما|ماذا)\s+(?:هي|هو)?\s*(?:حالة|وضع)\s+(?:هذا\s+)?المشروع)[؟?!.\s]*$/iu;

/**
 * An evidence-shaped question can still lack a safe subsystem target. Keep
 * this detector conservative: broad audits retain their separate consent
 * boundary, while a bounded project/architecture question enters the
 * source-first evidence path instead of being answered from the graph alone.
 */
export function isAmbiguousProjectQuery(message: string): boolean {
  if (BROAD_GAP_REQUEST_RE.test(message)) return false;
  if (PROJECT_ORIENTATION_RE.test(message.trim())) return false;
  if (resolveProjectQueryTarget(message)) return false;
  if (
    /(?:^|[\s`""'(])(?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml|css|scss|html)\b/iu.test(
      message,
    )
  ) {
    return false;
  }
  return (
    AMBIGUOUS_PROJECT_SCOPE_RE.test(message) &&
    AMBIGUOUS_PROJECT_ANALYSIS_RE.test(message)
  );
}

function materializeTarget(
  target: Omit<ProjectQueryTarget, ""confidence"">,
  confidence: number,
): ProjectQueryTarget {
  return {
    ...target,
    confidence,
    primaryPaths: [...target.primaryPaths],
    allowedExpansionPaths: [...target.allowedExpansionPaths],
    forbiddenPaths: [...target.forbiddenPaths],
    requiredEvidencePaths: [...target.requiredEvidencePaths],
    requiredClaims: target.requiredClaims.map((claim) => ({
      ...claim,
      requiredEvidencePaths: [...(claim.requiredEvidencePaths ?? [])],
    })),
  };
}

export function resolveProjectQueryTarget(message: string): ProjectQueryTarget | undefined {
  if (isAcceptanceCoverageRequest(message)) return undefined;
  if (isSessionQualityAuditRequest(message)) {
    return materializeTarget(
      {
        ...EMBEDDED_AI_TARGET,
        label: ""embedded-agent session quality"",
        promptHint: SESSION_QUALITY_PROMPT_HINT,
      },
      0.99,
    );
  }
  const aiSignal =
    /(?:الذكاء\s+الاصطناعي|ذكاء\s+اصطناعي|طبقة\s+(?:ال)?الذكاء\s+الاصطناعي|\bAI\b|\bLLM\b|provider|orchestrator|chat\s+agent|نموذج\s+الذكاء)/iu;
  const targetScopeSignal =
    /(?:تحليل|حلل|طبقة|داخل\s+المشروع|المشروع|embedded|integrated|architecture|layer|analy[sz]|trace|flow|وكيل|الوكيل|آلية\s+عمل|سلوك\s+الوكيل|كيف\s+يعمل)/iu;
  if (!aiSignal.test(message) || !targetScopeSignal.test(message)) {
    if (!isGapAnalysisRequest(message) || BROAD_GAP_REQUEST_RE.test(message)) {
      return undefined;
    }
    return materializeTarget(GAP_ANALYSIS_TARGET, 0.9);
  }
  return materializeTarget(EMBEDDED_AI_TARGET, 0.98);
}

export function resolveProjectQueryTargetResolution(
  message: string,
): ProjectQueryTargetResolution {
  return resolveProjectQueryTarget(message)
    ? ""resolved""
    : isAmbiguousProjectQuery(message)
      ? ""unresolved""
      : ""not_applicable"";
}

export function buildProjectQueryObjective(
  target: ProjectQueryTarget,
  goal: string,
): ObjectiveContract {
  const requiredClaims: ProjectQueryTarget[""requiredClaims""] = target.requiredClaims.map((claim) => ({
    claimId: claim.claimId,
    text: claim.text,
    requiredEvidencePaths: [...claim.requiredEvidencePaths],
    ...(claim.evidenceNeedles ? { evidenceNeedles: [...claim.evidenceNeedles] } : {}),
    ...(claim.evidenceNeedlesByPath
      ? {
          evidenceNeedlesByPath: Object.fromEntries(
            Object.entries(claim.evidenceNeedlesByPath).map(
              ([path, needles]) => [path, [...needles]],
            ),
          ),
        }
      : {}),
  }));
  if (isSessionQualityAuditRequest(goal)) {
    for (const claim of SESSION_QUALITY_CLAIMS) {
      requiredClaims.push({
        claimId: claim.claimId,
        text: claim.text,
        requiredEvidencePaths: [...claim.requiredEvidencePaths],
        ...(claim.evidenceNeedles ? { evidenceNeedles: [...claim.evidenceNeedles] } : {}),
        ...(claim.evidenceNeedlesByPath
          ? {
              evidenceNeedlesByPath: Object.fromEntries(
                Object.entries(claim.evidenceNeedlesByPath).map(
                  ([path, needles]) => [path, [...needles]],
                ),
              ),
            }
          : {}),
      });
    }
    if (
      SESSION_QUALITY_TRACE_RE.test(goal)
      && SESSION_QUALITY_DIVERGENCE_RE.test(goal)
    ) {
      for (const claim of SESSION_DIVERGENCE_CLAIMS) {
        requiredClaims.push({
          claimId: claim.claimId,
          text: claim.text,
          requiredEvidencePaths: [...claim.requiredEvidencePaths],
          ...(claim.evidenceNeedles ? { evidenceNeedles: [...claim.evidenceNeedles] } : {}),
          ...(claim.evidenceNeedlesByPath
            ? {
                evidenceNeedlesByPath: Object.fromEntries(
                  Object.entries(claim.evidenceNeedlesByPath).map(
                    ([path, needles]) => [path, [...needles]],
                  ),
                ),
              }
            : {}),
        });
      }
    }
  }
  const weaknessRequested = target.id === ""embedded-ai"" && isGapAnalysisRequest(goal);
  if (weaknessRequested) {
    requiredClaims.push({
      claimId: EMBEDDED_AI_WEAKNESS_CLAIM.claimId,
      text: EMBEDDED_AI_WEAKNESS_CLAIM.text,
      requiredEvidencePaths: [...EMBEDDED_AI_WEAKNESS_CLAIM.requiredEvidencePaths],
      evidenceNeedlesByPath: Object.fromEntries(
        Object.entries(EMBEDDED_AI_WEAKNESS_CLAIM.evidenceNeedlesByPath).map(
          ([path, needles]) => [path, [...needles]],
        ),
      ),
    });
  }
  const requiredEvidencePaths = new Set(target.requiredEvidencePaths);
  for (const claim of requiredClaims) {
    for (const path of claim.requiredEvidencePaths) requiredEvidencePaths.add(path);
  }
  return {
    objectiveType: `PROJECT_QUERY_${target.id.toUpperCase()}`,
    requiredEvidencePaths: [...requiredEvidencePaths],
    requiredClaims,
    requiredEvidenceEdges: EMBEDDED_AI_EXECUTION_EDGES.map((edge) => ({ ...edge })),
    scopePolicy: {
      primaryPaths: [...target.primaryPaths],
      allowedExpansionPaths: [...target.allowedExpansionPaths],
      forbiddenPaths: [...target.forbiddenPaths],
    },
    // Keep the user goal available to the objective-aware tool loop.
    ...(goal.trim() ? { goal: goal.trim() } : {}),
  } as ObjectiveContract;
}

export type ProjectQueryClaimContradiction = {
  claimId: string;
  reason: string;
};

function normalizeProjectSourcePath(value: string): string {
  return value.replace(/\\/g, ""/"").replace(/^\.\/+/, """").replace(/^\/+/, """");
}

/**
 * This is deliberately structural rather than a keyword-only check. The
 * source must show the finish-reason extraction, an explicit error comparison,
 * and the provider-response rejection in that order. A response is
 * contradictory only when it also makes a scoped negative assertion about
 * that guard in the same sentence/paragraph.
 */
function sourceProvesFinishReasonGuard(source: string): boolean {
  const binding = source.search(
    /\b(?:const|let|var)\s+finishReason\s*=[\s\S]{0,160}\bfinish_reason\b/,
  );
  const comparison = source.search(
    /\bif\s*\(\s*finishReason\s*===\s*[""']error[""']\s*\)/,
  );
  const rejection = source.search(
    /\bthrow\s+new\b[\s\S]{0,180}\bINVALID_PROVIDER_RESPONSE\b/,
  );
  return binding >= 0
    && comparison > binding
    && rejection > comparison;
}

function responseDeniesFinishReasonGuard(response: string): boolean {
  const concept =
    /\b(?:finish[_\s]?reason|finishReason|error[-\s]?shaped\s+response)\b/iu;
  const units = response
    .split(/(?:\r?\n){2,}|(?<=[.!?؟])\s+/u)
    .map((unit) => unit.trim())
    .filter(Boolean);

  return units.some((unit) => {
    if (!concept.test(unit)) return false;
    const deniesGuard =
      /(?:does\s+not|doesn't|did\s+not|didn't|fails?\s+to|failed\s+to|never|without|missing|absent|lacks?|lack\s+of|absence\s+of|no)\b[\s\S]{0,120}\b(?:reject|check|handle|process|validate|guard|throw)\b/iu.test(unit)
      || /\b(?:reject|check|handle|process|validate|guard|throw)\b[\s\S]{0,120}(?:does\s+not|doesn't|did\s+not|didn't|fails?\s+to|failed\s+to|never|without|missing|absent|lacks?|lack\s+of|absence\s+of|no)\b/iu.test(unit)
      || /(?:لا|لم|ليس|غير|يفتقد|غياب|عدم(?:\s+وجود)?|لا\s+(?:يوجد|توجد|يتم))[\s\S]{0,120}(?:فحص|تحقق|رفض|معالجة|حماية|يتعامل|يتحقق|يرفض)/u.test(unit)
      || /(?:فحص|تحقق|رفض|معالجة|حماية|يتعامل|يتحقق|يرفض)[\s\S]{0,120}(?:لا|لم|ليس|غير|يفتقد|غياب|عدم(?:\s+وجود)?)/u.test(unit);
    return deniesGuard;
  });
}

export function detectProjectQueryClaimContradictions(input: {
  objective: ObjectiveContract;
  response: string;
  evidence?: readonly EvidenceReference[];
  fileContents: ReadonlyMap<string, string>;
}): ProjectQueryClaimContradiction[] {
  if (!input.objective.objectiveType.startsWith(""PROJECT_QUERY_"")) return [];
  const weaknessClaim = input.objective.requiredClaims.find(
    (claim) => claim.claimId === ""ai-weakness-analysis"",
  );
  if (!weaknessClaim || !responseDeniesFinishReasonGuard(input.response)) return [];

  const providerPath = ""lib/ai-orchestrator/src/openai-compatible-client.ts"";
  const acceptedProviderEvidence = (input.evidence ?? []).some(
    (item) =>
      item.supportsClaim
      && normalizeProjectSourcePath(item.source) === providerPath
      && Boolean(item.excerpt?.trim()),
  );
  if (!acceptedProviderEvidence) return [];

  const providerBody = input.fileContents.get(providerPath) ?? """";
  if (!sourceProvesFinishReasonGuard(providerBody)) return [];

  return [{
    claimId: weaknessClaim.claimId,
    reason:
      'accepted source evidence proves finish_reason=""error"" is rejected before tool execution, but the answer asserts that this guard is absent',
  }];
}

export type ProjectQueryTargetDecision = {
  mode: ProjectQueryTargetMode;
};

export function deriveProjectQueryTargetMode(input: {
  targetResolution?: ProjectQueryTargetResolution;
  targetFiles?: readonly string[];
  targetConfidence?: number;
}): ProjectQueryTargetMode | undefined {
  if (input.targetResolution === ""resolved"") return ""resolved_target"";
  if (input.targetResolution !== ""unresolved"") return undefined;
  return input.targetFiles && input.targetFiles.length > 0
    && input.targetFiles.length <= 4
    && typeof input.targetConfidence === ""number""
    && input.targetConfidence >= 0.75
    ? ""bounded_unresolved_hint""
    : ""source_first_discovery"";
}

```",2026-09-19T21:01:34.550Z
bd3ac35d-2927-4133-bb7c-e2fa46931a41,8e78c54c-23e5-445e-85ec-6e3816154184,lib/ai-orchestrator/src/turn-intent.ts,source,,,cc0207c04f3458efacb145d3982b53889f35db646586f03237e764fcb286b85e,28127,1,0,"File: lib/ai-orchestrator/src/turn-intent.ts
```
import {
  classifyRequest,
  isLowRiskChatQuestion,
  isProjectOrientationQuestion,
  type ClassifiedRequest,
  type RequestCategory,
} from ""./prompts/profile-classifier.js"";
import {
  isExplicitBehaviorQueryRequest,
  isGapAnalysisRequest,
  isProductionReachabilityRequest,
  normalizeIntentText,
  routeTask,
  type AnalysisMode,
  type ForensicTaskType,
  type OutputContract,
} from ""./task-contracts.js"";
import type { TaskType } from ""./quality/task-profile.js"";
import {
  resolveOperationalCommand,
  type OperationalCommand,
} from ""./operational-command.js"";
import { isRunProjectScanRequest } from ""./scan-command.js"";
import type {
  ProjectQueryTargetMode,
  ProjectQueryTargetResolution,
} from ""./project-query-target.js"";
import {
  isArabicExplicitExecutionActionRequest,
  isArabicMutationActionRequest,
} from ""./arabic-action-intent.js"";
import {
  isEnglishExplicitExecutionActionRequest,
  isEnglishMutationActionRequest,
  normalizeEnglishActionText,
} from ""./english-action-intent.js"";

export { isRunProjectScanRequest } from ""./scan-command.js"";
export {
  isRestartServicesRequest,
  normalizeOperationalCommandText,
  resolveOperationalCommand,
} from ""./operational-command.js"";
export type { OperationalCommand } from ""./operational-command.js"";

export type TurnIntentKind =
  | ""CHAT""
  | ""PROJECT_QUERY""
  | ""FORENSIC_AUDIT""
  | ""DELIVERY"";

export type TurnOperationMode = ""CHAT"" | ""FORENSIC_AUDIT"" | ""DELIVERY"";
export type TurnServerAction = ""RUN_PROJECT_SCAN"" | ""RESTART_SERVICES"";
export type TurnContextMode = ""light"" | ""project"";

export type TurnIntentPhase =
  | ""evidence""
  | ""proposal""
  | ""execution""
  | ""validation"";

/**
 * The single request-routing decision shared by the API, orchestrator, model
 * selector, tool loop, and UI response metadata.
 *
 * `hasTools` is intentionally absent: tool availability is a runtime
 * capability (`rootPath`, provider support). `requiresTools` is user intent.
 */
export type TurnIntent = {
  kind: TurnIntentKind;
  category: RequestCategory;
  forensicTaskType: ForensicTaskType;
  analysisMode: AnalysisMode;
  outputContract: OutputContract;
  executionTaskType: TaskType;
  requiresTools: boolean;
  requiresEvidence: boolean;
  resumed: boolean;
  allowsResume: boolean;
  allowsBuildHandoff: boolean;
  implementationPlanResume: boolean;
  /** Broad forensic requests must declare a scope before expensive discovery. */
  scopeClarificationRequired: boolean;
  /**
   * The message contains an ordered read/inspect step followed by a
   * change-oriented step. This is a planning signal only; write and validation
   * authorization still comes from the server-owned operation contract.
   */
  compoundExecution: boolean;
  /** True only when the compound request asks for a later project mutation. */
  compoundWrite: boolean;
  /** Ordered phases requested by the user, not a permission grant. */
  phases: readonly TurnIntentPhase[];
  /** User-readable description of the boundary approved for this audit. */
  auditScopeDescription?: string;
  operationMode: TurnOperationMode;
  /** Server-owned context depth; social chat stays on the lightweight path. */
  contextMode: TurnContextMode;
  classification: ClassifiedRequest;
  /** Server-owned subsystem target for a targeted read-only project query. */
  projectTarget?: ClassifiedRequest[""projectTarget""];
  /** Server-owned target resolution state, including safe ambiguity handling. */
  projectTargetResolution: ProjectQueryTargetResolution;
  /** Server-owned initial source-targeting mode; planning may refine unresolved queries. */
  projectQueryTargetMode?: ProjectQueryTargetMode;
  /** A deterministic server-owned action that must not be delegated to a provider. */
  serverAction?: TurnServerAction;
  /** Details for a deterministic operational command, when one was recognized. */
  operationalCommand?: OperationalCommand;
};

/**
 * Apply serialization is only needed while a turn is allowed to prepare
 * write-capable changes. Tool availability alone is not sufficient: project
 * questions, forensic reads, implementation-plan creation, and read-only plan
 * continuations all use tools without changing project state.
 */
export function isWriteCapableTurn(intent: Pick<
  TurnIntent,
  | ""kind""
  | ""implementationPlanResume""
  | ""allowsBuildHandoff""
  | ""classification""
  | ""compoundExecution""
  | ""compoundWrite""
>): boolean {
  return intent.allowsBuildHandoff ||
    (
      intent.kind === ""DELIVERY"" &&
      !intent.implementationPlanResume &&
      !intent.classification.implementationPlanMode &&
      !(intent.compoundExecution && !intent.compoundWrite)
    );
}

const RESUMABLE_FORENSIC_TASKS = new Set<ForensicTaskType>([
  ""FINDING_ANALYSIS"",
  ""FULL_FORENSIC_AUDIT"",
  ""WORKSPACE_REVIEW"",
  ""REPAIR_ANALYSIS"",
]);

const PROJECT_TOOL_SIGNAL_RE =
  /(?:\b(?:file|folder|directory|repository|repo|codebase|project|source|function|class|method|module|component|handler|middleware|endpoint|route|schema|database|table|query|test|bug|error|implementation|architecture|workflow|pipeline|dependency|dependencies|configuration|config|api|branch|commit|loop|iteration|iterations|behavior|behaviour|return|result|call|invocation|limit|counter)\b|ملف|مجلد|مستودع|مشروع|كود|شفرة|مصدر|دالة|وحدة|مكوّن|مكون|واجهة|مسار|مخطط|قاعدة\s+بيانات|جدول|استعلام|اختبار|خطأ|خلل|تنفيذ|معمارية|سير\s+العمل|اعتماديات|إعدادات|حلقة|تكرار|سلوك|سلوك\s+الوكيل|وكيل|الوكيل|آلية\s+عمل|إرجاع|نتيجة)/iu;

const SOURCE_PATH_RE =
  /(?:^|[\s`""'(])(?:\.{0,2}\/)?[\w@.-]+(?:\/[\w@.-]+)*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml|css|scss|html)\b/iu;
const PLAN_EXECUTION_REQUEST_RE =
  /^\s*(?:(?:ابدأ|ابدا|إبدأ|إبدا|start|proceed|go\s+ahead)\s+)?(?:في\s+)?(?:تنفيذ|تطبيق|تعديل|إصلاح|implement|apply|execute)\s+(?:هذه\s+|the\s+|this\s+|approved\s+)?(?:الخطة|التعديلات|الإصلاحات|plan|changes|fixes)(?:\s|$|[.,!?])/iu;

/**
 * A plan-execution command is not a generic implementation request. It must
 * carry the server-owned approved Build handoff, otherwise the route would
 * accept arbitrary source reads as proof of execution without a proposal or
 * apply journal.
 */
export function isPlanExecutionRequest(message: string): boolean {
  const normalized = message.normalize(""NFKC"").replace(/[\u064B-\u065F\u0670]/g, """");
  return PLAN_EXECUTION_REQUEST_RE.test(normalized);
}

const ENGLISH_COMPOUND_SEQUENCE_RE =
  /(?:\b(?:then|and|after|once|followed\s+by)\b(?:\s+(?:then|after|once))?\s*)/i;

/**
 * `then after` and `then once` may introduce one short, source-qualified
 * evidence clause before the later action, for example:
 * ""then after reading the file, fix the bug"".
 *
 * Keep this bridge structural rather than adding read/gerund vocabulary to
 * the shared English action contract. A comma is required, the clause must
 * mention a source-like target, and its length is bounded so arbitrary prose
 * cannot become a compound action.
 */
const ENGLISH_NESTED_COMPOUND_BRIDGE_RE =
  /^(?:(?=[^.!?\n,]{1,100},\s*)(?=[^.!?\n,]*\b(?:file|folder|directory|source|codebase|repository|repo|project)\b)|(?=[^!?\n,]{1,100},\s*)(?=[^!?\n,]*\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|md|json|yaml|yml|toml|css|scss|html)\b))[^!?\n,]{1,100},\s*/i;

/**
 * Validation actions are intentionally limited to the existing compound
 * validation contract. Mutation and explicit-execution wording comes from
 * english-action-intent.ts instead of being repeated here.
 */
const ENGLISH_COMPOUND_VALIDATION_RE =
  /^(?:(?:please|kindly)\s+)?(?:(?:run|execute)\s+(?:the\s+)?tests?\b|run\s+validation\b|validate\b)/i;

const ARABIC_COMPOUND_REQUEST_RE =
  /(?:ثم\s*|وبعد(?:ها)?\s*|بعد(?:ها| ذلك)?\s*)(?:please\s+|kindly\s+)?(?:اختبر|شغّل|شغل|تحقق|أصلح|صحح|عدّل|عدل|غيّر|غير|اكتب|طبّق|طبق|نفّذ|نفذ|ابنِ|أنشئ|أضف|احذف)/iu;

const ARABIC_COMPOUND_WRITE_REQUEST_RE =
  /(?:ثم\s*|وبعد(?:ها)?\s*|بعد(?:ها| ذلك)?\s*)(?:please\s+|kindly\s+)?(?:أصلح|صحح|عدّل|عدل|غيّر|غير|اكتب|طبّق|طبق|نفّذ|نفذ|ابنِ|أنشئ|أضف|احذف)/iu;

function getEnglishCompoundActionSegment(message: string): string | null {
  const normalized = message.normalize(""NFKC"").replace(/\s+/g, "" "").trim();
  const marker = ENGLISH_COMPOUND_SEQUENCE_RE.exec(normalized);
  if (!marker) return null;

  const markerText = marker[0].trim();
  const remainder = normalized.slice(marker.index + marker[0].length).trim();
  if (/^then\s+(?:after|once)$/i.test(markerText)) {
    const bridge = ENGLISH_NESTED_COMPOUND_BRIDGE_RE.exec(remainder);
    if (!bridge) return null;
    return normalizeEnglishActionText(remainder.slice(bridge[0].length));
  }

  return normalizeEnglishActionText(remainder);
}

function isEnglishCompoundValidationAction(segment: string): boolean {
  return ENGLISH_COMPOUND_VALIDATION_RE.test(segment);
}

function isEnglishCompoundActionRequest(message: string): boolean {
  const segment = getEnglishCompoundActionSegment(message);
  if (!segment) return false;
  return (
    isEnglishMutationActionRequest(segment) ||
    isEnglishExplicitExecutionActionRequest(segment) ||
    isEnglishCompoundValidationAction(segment)
  );
}

function isEnglishCompoundWriteAction(message: string): boolean {
  const segment = getEnglishCompoundActionSegment(message);
  if (!segment || isEnglishCompoundValidationAction(segment)) return false;
  return isEnglishMutationActionRequest(segment);
}

/**
 * Arabic users commonly qualify the transition instead of placing the
 * mutation verb immediately after ""then"", for example:
 * ""بعد اكتمال قراءة المصدر، انتقل إلى مسار الإصلاح وأنشئ تغييرًا معلّقًا"".
 * Keep this bridge deliberately narrow so explanatory text such as
 * ""ثم اشرح كيف أصلح..."" remains read-only.
 */
const ARABIC_QUALIFIED_COMPOUND_REQUEST_RE =
  /(?:بعد\s+(?:اكتمال|الانتهاء\s+من)\s+[^.!?\n،]{1,100}[،,]\s*(?:انتقل|ننتقل)\s+إلى\s+(?:مسار\s+)?[^.!?\n]{0,100}?(?:ثم\s+)?|بعد\s+(?:اكتمال|الانتهاء\s+من)\s+[^.!?\n،]{1,100}[،,]\s*)(?:و)?(?:أصلح|صحح|عدّل|عدل|غيّر|غير|اكتب|طبّق|طبق|نفّذ|نفذ|ابنِ|أنشئ|أضف|احذف)/iu;

const FORENSIC_EVIDENCE_SIGNAL_RE =
  /(?:\b(?:audit|forensic|root\s+cause|prove|verify|investigate)\b|تدقيق|جنائي|تحقيق|تحقق|تحقّق|السبب\s+الجذري|الأسباب\s+الجذرية|الاسباب\s+الجذرية|الأسباب\s+الجذريه|الاسباب\s+الجذريه|تتبع\s+مسار\s+(?:الجلسة|الجلسه)|تتبع\s+(?:الجلسة|الجلسه)\s+الأخيرة|تتبع\s+(?:الجلسة|الجلسه)\s+الاخيرة|أثبت|اثبت)/iu;

type EvidenceRoutingSignals = {
  classification: ClassifiedRequest;
  routeRequiresEvidence: boolean;
  isLowRiskChat: boolean;
  implementationDelivery: boolean;
  planDelivery: boolean;
  implementationPlanResume: boolean;
  broadForensicTask: boolean;
  broadAuditIntent: boolean;
  hasProjectToolSignal: boolean;
  message: string;
  normalizedMessage: string;
  gapAnalysisProjectQuery: boolean;
  targetedProjectQuery: boolean;
  unresolvedProjectQuery: boolean;
  resumedForensicContinuation: boolean;
  projectOrientation: boolean;
};

/**
 * Evidence policy firewall.
 *
 * Classification is intentionally heuristic and may contain several matching
 * signals. Keep precedence here, at one boundary, instead of repeating
 * `category !== ""exploration""` and forensic exceptions throughout the route:
 *
 *   low-risk/plan/delivery/exploration → no evidence
 *   deep analysis or evidence-capable task → evidence signals
 *   targeted/gap/resumed project query → evidence when explicitly grounded
 *
 * The function returns the existing evidence intent only; tool access and
 * delivery authorization remain separate decisions below.
 */
function resolveEvidenceIntent({
  classification,
  routeRequiresEvidence,
  isLowRiskChat,
  implementationDelivery,
  planDelivery,
  implementationPlanResume,
  broadForensicTask,
  broadAuditIntent,
  hasProjectToolSignal,
  message,
  normalizedMessage,
  gapAnalysisProjectQuery,
  targetedProjectQuery,
  unresolvedProjectQuery,
  resumedForensicContinuation,
  projectOrientation,
}: EvidenceRoutingSignals): boolean {
  const isExploration = classification.category === ""exploration"";
  const isDeepAnalysis = classification.category === ""deep_analysis"";

  // These are hard boundaries, not competing scores.
  if (
    isLowRiskChat ||
    isExploration ||
    implementationDelivery ||
    planDelivery ||
    implementationPlanResume ||
    projectOrientation
  ) {
    return false;
  }

  const evidenceCapable = routeRequiresEvidence || isDeepAnalysis;
  if (!evidenceCapable) return false;

  const categoryEvidence =
    isDeepAnalysis ||
    classification.analysisMode === ""FORENSIC"" ||
    classification.structuredOutputMode ||
    classification.singleFileForensicMode ||
    classification.orderedForensicRoots.length > 0;

  const explicitEvidence =
    (!broadForensicTask || broadAuditIntent) && categoryEvidence;
  const behaviorEvidence =
    hasProjectToolSignal &&
    !isProjectOrientationQuestion(message) &&
    isExplicitBehaviorQueryRequest(message);
  const projectEvidence =
    gapAnalysisProjectQuery ||
    targetedProjectQuery ||
    unresolvedProjectQuery;

  return (
    explicitEvidence ||
    behaviorEvidence ||
    isProductionReachabilityRequest(normalizedMessage) ||
    FORENSIC_EVIDENCE_SIGNAL_RE.test(normalizedMessage) ||
    projectEvidence ||
    resumedForensicContinuation
  );
}

const EXPLICIT_AUDIT_SCOPE_RE =
  /(?:\b(?:src|lib|app|server|client|test|tests|components?|pages?|routes?|api|packages?|artifacts?|files?)\b|[./][\w@.-]+(?:\/[\w@.-]+)*|[\w@.-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|rb|sql|sh|json|yaml|yml|toml|css|scss|html)\b|specific\s+(?:file|folder|directory|module)|(?:whole|entire|full|all)\s+(?:the\s+)?(?:project|workspace|repository|repo|codebase|code)|(?:of|on|in)\s+the\s+(?:project|workspace|repository|repo|codebase)|مجلد\s+(?:محدد|معين)|ملف(?:ات)?\s+(?:محدد(?:ة)?|معين(?:ة)?)|هذا\s+الملف|الملفات\s+الإنتاجية|الكود\s+الإنتاجي|(?:شامل|شاملة|كامل|كاملة|واسع|واسعة)\s+(?:للمشروع|لمشروعي|للمستودع|لمستودعي|للريبو|لقاعدة\s+(?:الكود|الشفرة|المصدر)|المشروع|مشروعي|المستودع|مستودعي|الريبو|قاعدة\s+(?:الكود|الشفرة|المصدر))|(?:في|على|ضمن|داخل)\s+(?:المشروع|مشروعي|المستودع|مستودعي|الريبو|قاعدة\s+(?:الكود|الشفرة|المصدر))|(?:المشروع|مشروعي|المستودع|مستودعي|الريبو|قاعدة\s+(?:الكود|الشفرة|المصدر))\s+(?:بالكامل|كله|كاملًا|كاملة)|كل\s+(?:المشروع|المستودع|الريبو|الكود|قاعدة\s+(?:الكود|الشفرة|المصدر))|المشروع\s+كله)/iu;
function isExecutionActionRequest(message: string): boolean {
  return (
    isEnglishMutationActionRequest(message) ||
    isArabicMutationActionRequest(message)
  );
}

/**
 * Detect an ordered compound request without treating audit language as an
 * authorization. The direct-action matcher intentionally remains separate:
 * ""fix the bug"" is a delivery request, while ""inspect the file then fix the
 * bug"" is a compound delivery request that must retain its evidence-first
 * ordering.
 */
export function isCompoundExecutionRequest(message: string): boolean {
  const normalized = message.normalize(""NFKC"").replace(/[\u064B-\u065F\u0670]/g, """");
  if (isExecutionActionRequest(normalized)) return false;
  return isEnglishCompoundActionRequest(normalized) ||
    ARABIC_COMPOUND_REQUEST_RE.test(normalized) ||
    ARABIC_QUALIFIED_COMPOUND_REQUEST_RE.test(normalized);
}

export function isCompoundWriteRequest(message: string): boolean {
  const normalized = message.normalize(""NFKC"").replace(/[\u064B-\u065F\u0670]/g, """");
  if (isExecutionActionRequest(normalized)) return false;
  return isEnglishCompoundWriteAction(normalized) ||
    ARABIC_COMPOUND_WRITE_REQUEST_RE.test(normalized) ||
    ARABIC_QUALIFIED_COMPOUND_REQUEST_RE.test(normalized);
}

export function resolveTurnIntent(
  message: string,
  options: {
    classification?: ClassifiedRequest;
    resumed?: boolean;
    buildHandoff?: boolean;
    implementationPlanResume?: boolean;
    projectOrientation?: boolean;
  } = {},
): TurnIntent {
  const baseClassification = options.classification ?? classifyRequest(message);
  const normalizedMessage = normalizeIntentText(message);
  const operationalCommand = resolveOperationalCommand(message);
  const serverAction = isRunProjectScanRequest(message)
    ? ""RUN_PROJECT_SCAN"" as const
    : operationalCommand?.kind;
  const buildHandoff = options.buildHandoff === true;
  const implementationPlanResume = options.implementationPlanResume === true;
  const compoundExecution = isCompoundExecutionRequest(message);
  const compoundWrite = isCompoundWriteRequest(message);
  // Explicit implementation-plan language remains read-only, and ordinary
  // direct mutations remain reviewable plan requests. Task-shaped requests and
  // explicit execution continuations retain task_execution so the server-owned
  // policy can collect telemetry and produce deterministic degradation reports.
  const directImplementationPlanRequest =
    !buildHandoff &&
    !implementationPlanResume &&
    !compoundWrite &&
    !baseClassification.implementationTaskMode &&
    !isArabicExplicitExecutionActionRequest(message) &&
    !isEnglishExplicitExecutionActionRequest(message) &&
    (
      baseClassification.implementationPlanMode ||
      isExecutionActionRequest(message)
    );
  const classification = directImplementationPlanRequest
    ? {
        ...baseClassification,
        implementationPlanMode: true,
        implementationTaskMode: false,
      }
    : baseClassification;
  const projectOrientation = options.projectOrientation === true;
  const route = routeTask(classification.taskType);
  const planDelivery =
    !buildHandoff && !implementationPlanResume && classification.implementationPlanMode;
  const implementationDelivery =
    buildHandoff ||
    (
      !planDelivery &&
      (
        classification.implementationTaskMode ||
        isExecutionActionRequest(message) ||
        compoundExecution
      )
    );
  const targetedProjectQuery = Boolean(classification.projectTarget);
  const unresolvedProjectQuery =
    classification.projectTargetResolution === ""unresolved"";
  const projectQueryTargetMode: ProjectQueryTargetMode | undefined =
    classification.projectTargetResolution === ""resolved""
      ? ""resolved_target""
      : classification.projectTargetResolution === ""unresolved""
        ? ""source_first_discovery""
        : undefined;
  const hasProjectToolSignal =
    SOURCE_PATH_RE.test(message) || PROJECT_TOOL_SIGNAL_RE.test(message);
  // Generic/social questions classified as simple must remain fast, tool-free
  // turns. Project-orientation questions use the same lightweight profile but
  // intentionally remain eligible for project read capability below.
  const isLowRiskChat =
    classification.category === ""simple"" &&
    classification.allowPrefetch === false &&
    classification.analysisMode === ""STANDARD"" &&
    classification.taskType === ""BEHAVIOR_QUERY"" &&
    !classification.structuredOutputMode &&
    !classification.singleFileForensicMode &&
    classification.orderedForensicRoots.length === 0 &&
    isLowRiskChatQuestion(message) &&
    !isGapAnalysisRequest(message) &&
    !implementationDelivery &&
    !classification.implementationTaskMode &&
    !classification.implementationPlanMode;
  const broadForensicTask =
    classification.taskType === ""FULL_FORENSIC_AUDIT"" ||
    classification.taskType === ""WORKSPACE_REVIEW"";
  // Gap questions are analytical project queries, but they are not broad
  // forensic audits unless the classifier already assigned a broad task.
  // Keep this separate from projectTarget: a question such as ""what are the
  // agent's weaknesses?"" still needs grounded claims even when it does not
  // name the embedded-AI target explicitly.
  const gapAnalysisProjectQuery =
    classification.taskType === ""BEHAVIOR_QUERY"" &&
    classification.analysisMode === ""STANDARD"" &&
    !classification.structuredOutputMode &&
    !classification.singleFileForensicMode &&
    isGapAnalysisRequest(message);
  const broadAuditIntent =
    !broadForensicTask ||
    BROAD_AUDIT_REQUEST_RE.test(normalizedMessage) ||
    EXPLICIT_STRUCTURED_AUDIT_RE.test(normalizedMessage) ||
    hasExplicitAuditScope(normalizedMessage, classification);
  const projectQueryEvidence =
    (!broadForensicTask || !broadAuditIntent) &&
    (targetedProjectQuery || unresolvedProjectQuery || gapAnalysisProjectQuery);
  const scopeClarificationRequired =
    !buildHandoff &&
    !options.resumed &&
    !planDelivery &&
    !implementationDelivery &&
    broadForensicTask &&
    BROAD_AUDIT_REQUEST_RE.test(normalizedMessage) &&
    !EXPLICIT_STRUCTURED_AUDIT_RE.test(normalizedMessage) &&
    !hasExplicitAuditScope(normalizedMessage, classification);
  // A short approval/continuation inherits the already-approved forensic
  // contract. Its raw text (""ابدأ"", ""continue"") does not repeat the audit
  // keywords, but it must still reach the read-only evidence path.
  const resumedForensicContinuation =
    options.resumed === true &&
    !implementationPlanResume &&
    !implementationDelivery &&
    !planDelivery &&
     route.requiresEvidence &&
    !scopeClarificationRequired;

  const explicitEvidenceIntent = resolveEvidenceIntent({
    classification,
    routeRequiresEvidence: route.requiresEvidence,
    isLowRiskChat,
    implementationDelivery,
    planDelivery,
    implementationPlanResume,
    broadForensicTask,
    broadAuditIntent,
    hasProjectToolSignal,
    message,
    normalizedMessage,
    gapAnalysisProjectQuery,
    targetedProjectQuery,
    unresolvedProjectQuery,
    resumedForensicContinuation,
    projectOrientation,
  });

  const requiresTools =
    isLowRiskChat
      ? false
      : implementationDelivery ||
        implementationPlanResume ||
        // Exploration turns route to PROJECT_QUERY with bounded reads so the
        // model can cite project context without entering the evidence gate.
        classification.category === ""exploration"" ||
        (explicitEvidenceIntent && !scopeClarificationRequired) ||
         (!planDelivery && hasProjectToolSignal && !scopeClarificationRequired) ||
         projectOrientation;

  const kind: TurnIntentKind = implementationDelivery || planDelivery
    ? ""DELIVERY""
    : explicitEvidenceIntent &&
        !scopeClarificationRequired &&
        !projectQueryEvidence
      ? ""FORENSIC_AUDIT""
      : requiresTools
        ? ""PROJECT_QUERY""
        : ""CHAT"";
  const executionTaskType: TaskType = implementationDelivery
    ? ""task_execution""
     : explicitEvidenceIntent &&
         !scopeClarificationRequired &&
          !projectQueryEvidence
      ? ""analysis""
      : requiresTools
        ? ""tool_chat""
        : ""chat"";
  const operationMode: TurnOperationMode =
    kind === ""DELIVERY""
      ? ""DELIVERY""
      : kind === ""FORENSIC_AUDIT""
        ? ""FORENSIC_AUDIT""
        : ""CHAT"";
  const contextMode: TurnContextMode =
    isLowRiskChat ||
    (
      classification.category === ""simple"" &&
      !targetedProjectQuery &&
      !hasProjectToolSignal
    )
      ? ""light""
      : ""project"";
  const phases: TurnIntentPhase[] =
    compoundExecution
      ? compoundWrite
        ? [""evidence"", ""proposal""]
        : [""evidence"", ""validation""]
      : implementationDelivery
        ? [""execution""]
         : explicitEvidenceIntent && !scopeClarificationRequired
          ? [""evidence""]
          : [];

  return {
    kind,
    category: classification.category,
    forensicTaskType: classification.taskType,
    analysisMode: explicitEvidenceIntent && !scopeClarificationRequired
      ? classification.analysisMode
      : ""STANDARD"",
    outputContract:
      kind === ""CHAT"" || (kind === ""PROJECT_QUERY"" && !explicitEvidenceIntent)
        ? ""GENERIC_RESPONSE""
        : classification.outputContract,
    executionTaskType,
    requiresTools,
    requiresEvidence: explicitEvidenceIntent && !scopeClarificationRequired,
    resumed: options.resumed === true,
    allowsResume:
      options.resumed === true ||
      (kind !== ""CHAT"" && RESUMABLE_FORENSIC_TASKS.has(classification.taskType)),
    allowsBuildHandoff: buildHandoff,
    implementationPlanResume,
    scopeClarificationRequired,
    compoundExecution,
    compoundWrite,
    phases,
    ...(classification.projectTarget ? { projectTarget: classification.projectTarget } : {}),
    projectTargetResolution:
      classification.projectTargetResolution ?? ""not_applicable"",
    ...(projectQueryTargetMode ? { projectQueryTargetMode } : {}),
    ...(serverAction ? { serverAction } : {}),
    ...(operationalCommand ? { operationalCommand } : {}),
    ...(explicitEvidenceIntent && !scopeClarificationRequired
      ? { auditScopeDescription: describeAuditScope(classification, normalizedMessage) }
      : {}),
    operationMode,
    contextMode,
    classification,
  };
}

const EXPLICIT_STRUCTURED_AUDIT_RE =
  /(?:\b(?:required\s+output|forensic\s+findings?|findings?\s+matrix|final\s+verdict|executive\s+verdict)\b|#{1,3}\s*1[.)]\s|الأقسام\s+الستة|المخرجات\s+المطلوبة)/iu;

function hasExplicitAuditScope(message: string, classification: ClassifiedRequest): boolean {
  return (
    classification.singleFileForensicMode ||
    classification.orderedForensicRoots.length > 0 ||
    EXPLICIT_AUDIT_SCOPE_RE.test(message)
  );
}

function describeAuditScope(classification: ClassifiedRequest, message: string): string | undefined {
  const roots = classification.orderedForensicRoots
    .map((root) => root.replace(/\\/g, ""/"").split(""/"").filter(Boolean).pop())
    .filter((root): root is string => Boolean(root));
  if (classification.singleFileForensicMode && roots.length > 0) {
    return roots.length === 1
      ? `the selected file “${roots[0]}”`
      : `the selected files: ${roots.join("", "")}`;
  }
  if (roots.length > 0) {
    return roots.length === 1
      ? `the selected folder “${roots[0]}”`
      : `the selected folders: ${roots.join("", "")}`;
  }
  if (BROAD_AUDIT_REQUEST_RE.test(message) && hasExplicitAuditScope(message, classification)) {
    return ""the whole project"";
  }
  return undefined;
}

const BROAD_AUDIT_REQUEST_RE =
  /(?:\b(?:audit|review|inspect|assess|evaluate|scan)\b[\s\S]{0,100}\b(?:project|workspace|repository|repo|codebase|problems?|issues?|bugs?|architecture|gaps?)\b|\banaly[sz]e\b[\s\S]{0,100}\b(?:problems?|issues?|bugs?|vulnerabilit(?:y|ies)|gaps?)\b|\b(?:full|complete|comprehensive|whole|entire)\s+(?:project|workspace|repository|repo|codebase)\s+(?:audit|review|assessment|analysis)\b|(?:افحص|راجع|قيّم|قيم|حلل|حلّل|استكشف|دقق|دقّق|تدقيق|مراجعة|فحص)\s+(?:(?:في|على|ضمن|داخل)\s+)?(?:(?:كل|كامل|كاملة|بالكامل|شامل|شاملة|واسع|واسعة)\s+)?(?:مشروعي|المشروع|مساحة\s+العمل|مستودعي|المستودع|الريبو|ريبو|قاعدة\s+(?:الكود|الشفرة|المصدر)|المشاكل|المشكلات|الفجوات|المشكلات)(?:\s+(?:بالكامل|كله|كاملًا|كاملة))?)[\s\S]*/iu;

```",2026-09-19T21:01:34.550Z
f4f21e1e-f545-47e4-b253-9187df2f6e97,8e78c54c-23e5-445e-85ec-6e3816154184,lib/db/src/schema/ai_chats.ts,source,,,1781d069bfdd8cccefe7895884fdb191365ed9b1ec090f0fc54ed89aa24d2863,9849,1,0,"File: lib/db/src/schema/ai_chats.ts
```
import { pgTable, text, timestamp, pgEnum, index, real, jsonb, uniqueIndex, integer } from ""drizzle-orm/pg-core"";
import { projectsTable } from ""./projects.js"";
import { tasksTable } from ""./tasks.js"";

export const aiMessageRoleEnum = pgEnum(""ai_message_role"", [
  ""user"",
  ""assistant"",
  ""system"",
]);

export const aiChatSessionsTable = pgTable(""ai_chat_sessions"", {
  id: text(""id"").primaryKey(),
  projectId: text(""project_id"")
    .notNull()
    .references(() => projectsTable.id, { onDelete: ""cascade"" }),
  title: text(""title"").notNull().default(""New Chat""),
  /**
   * AI-TASK-001: Optional permanent link to a task so the chat agent operates
   * in task-aware mode. Nullable FK — cleared automatically when the task is
   * deleted; remains valid as long as the task exists.
   */
  linkedTaskId: text(""linked_task_id"")
    .references(() => tasksTable.id, { onDelete: ""set null"" }),
  /**
   * Verified resumable task contract for short continuation messages such as
   * ""أكمل"" or ""ابدأ"". Stored as validated JSON so the next request can resume
   * the task contract without trusting prose from the conversation history.
   */
  activeTaskState: text(""active_task_state""),
  createdAt: timestamp(""created_at"").notNull().defaultNow(),
  updatedAt: timestamp(""updated_at"").notNull().defaultNow(),
}, (t) => [
  // Covers: WHERE project_id = ? (session list for a project)
  index(""idx_ai_chat_sessions_project_id"").on(t.projectId),
  // Covers: WHERE project_id = ? ORDER BY updated_at DESC (most-recent sessions)
  index(""idx_ai_chat_sessions_project_id_updated_at"").on(t.projectId, t.updatedAt),
  // Covers: WHERE linked_task_id = ? (find all sessions for a task)
  index(""idx_ai_chat_sessions_linked_task_id"").on(t.linkedTaskId),
]);

export const aiChatMessagesTable = pgTable(""ai_chat_messages"", {
  id: text(""id"").primaryKey(),
  sessionId: text(""session_id"")
    .notNull()
    .references(() => aiChatSessionsTable.id, { onDelete: ""cascade"" }),
  role: aiMessageRoleEnum(""role"").notNull(),
  content: text(""content"").notNull(),
  /** JSON array of source strings (file paths, node names, etc.) */
  sources: text(""sources""),
  /** JSON array of bounded execution-trace metadata; never part of report content. */
  toolTrace: text(""tool_trace""),
  /** JSON array of server-verified executable Repair Plan phases. */
  repairPlanMetadata: text(""repair_plan_metadata""),
  /** JSON array of accepted behavior-evidence references, each with an optional exact source line span. */
  behaviorEvidence: text(""behavior_evidence""),
  /** Versioned, redacted mission correlation report for historical run messages. */
  missionCorrelationReport: text(""mission_correlation_report""),
  /** Server-authoritative routing decision for this conversational turn. */
  turnIntent: text(""turn_intent""),
  /** Durable execution linked to this turn, when the turn used one. */
  executionId: text(""execution_id""),
  /** Terminal outcome; failed/interrupted turns are retained without an answer. */
  outcome: text(""outcome""),
  /** Bounded provider/execution failure code for an auditable failed turn. */
  errorCode: text(""error_code""),
  errorMessage: text(""error_message""),
  /**
   * Serialized AI-008 per-task typed result (discriminated on `kind` by
   * forensicTaskType). Persisted so a reloaded/history session can re-render the
   * structured panel; null for generic chat turns that map to no typed contract.
   */
  taskResult: text(""task_result""),
  createdAt: timestamp(""created_at"").notNull().defaultNow(),
}, (t) => [
  // Covers: WHERE session_id = ? (load all messages for a session)
  index(""idx_ai_chat_messages_session_id"").on(t.sessionId),
  // Covers: WHERE session_id = ? ORDER BY created_at ASC (chronological thread)
  index(""idx_ai_chat_messages_session_id_created_at"").on(t.sessionId, t.createdAt),
]);

export type InsertAiChatSession = typeof aiChatSessionsTable.$inferInsert;
export type AiChatSession = typeof aiChatSessionsTable.$inferSelect;
export type InsertAiChatMessage = typeof aiChatMessagesTable.$inferInsert;
export type AiChatMessage = typeof aiChatMessagesTable.$inferSelect;

// ── AI Session Memories ───────────────────────────────────────────────────────

export const aiMemoryTypeEnum = pgEnum(""ai_memory_type"", [
  ""file_summary"",
  ""entity_fact"",
  ""session_summary"",
  ""key_finding"",
]);

export const aiSemanticMemoryKindEnum = pgEnum(""ai_semantic_memory_kind"", [
  ""decision"",
  ""constraint"",
  ""unresolved_question"",
  ""key_finding"",
]);

export const aiSemanticMemoryProvenanceEnum = pgEnum(""ai_semantic_memory_provenance"", [
  ""explicit_user_decision"",
  ""explicit_user_statement"",
  ""accepted_plan"",
  ""validated_finding"",
]);

export const aiSemanticMemoryConfirmationEnum = pgEnum(""ai_semantic_memory_confirmation"", [
  ""unconfirmed"",
  ""user_confirmed"",
  ""server_validated"",
]);

export const aiSemanticMemoryFreshnessEnum = pgEnum(""ai_semantic_memory_freshness"", [
  ""current_at_write"",
  ""stale"",
  ""unknown"",
]);

/**
 * Cross-session memory: stores summaries of files accessed and key findings
 * from each chat session so subsequent sessions can skip re-discovery.
 *
 * Populated at the end of every successful chat exchange; injected into the
 * system prompt at the start of the next session for the same project.
 *
 * Relevance decays 10% once per completed 24-hour period; rows are pruned
 * when relevance drops below 0.1 or when expires_at passes (default 30 days).
 */
export const aiSessionMemoriesTable = pgTable(""ai_session_memories"", {
  id: text(""id"").primaryKey(),
  projectId: text(""project_id"")
    .notNull()
    .references(() => projectsTable.id, { onDelete: ""cascade"" }),
  sessionId: text(""session_id"")
    .notNull()
    .references(() => aiChatSessionsTable.id, { onDelete: ""cascade"" }),
  memoryType: aiMemoryTypeEnum(""memory_type"").notNull(),
  content: text(""content"").notNull(),
  /** Absolute or project-relative path for file_summary / entity_fact rows. */
  sourcePath: text(""source_path""),
  /** Stable project-scoped key used to refresh a memory instead of duplicating it. */
  dedupeKey: text(""dedupe_key""),
  /** Nullable semantic discriminator; null preserves legacy navigation rows. */
  semanticKind: aiSemanticMemoryKindEnum(""semantic_kind""),
  /** Project or task scope used to rank semantic memories. */
  scope: text(""scope""),
  /** Originating turn; null for legacy rows. */
  turnId: text(""turn_id""),
  /** Explicit provenance category; null for legacy rows. */
  provenance: aiSemanticMemoryProvenanceEnum(""provenance""),
  /** Source path, receipt, or other bounded reference for semantic rows. */
  sourceReference: text(""source_reference""),
  /** Revision observed when the semantic record was accepted. */
  sourceRevision: text(""source_revision""),
  /** 0.0 – 1.0 confidence assigned by the server-owned extractor. */
  confidence: real(""confidence""),
  confirmationStatus: aiSemanticMemoryConfirmationEnum(""confirmation_status""),
  freshnessStatus: aiSemanticMemoryFreshnessEnum(""freshness_status""),
  /** 0.0 – 1.0: decays over time; rows below 0.1 are pruned on sweep. */
  relevance: real(""relevance"").notNull().default(1.0),
  createdAt: timestamp(""created_at"").notNull().defaultNow(),
  /** Hard expiry — null means never expires. Default: createdAt + 30 days. */
  expiresAt: timestamp(""expires_at""),
  /** Last completed 24-hour decay boundary; prevents a six-hour sweep from over-decaying. */
  lastDecayAt: timestamp(""last_decay_at""),
}, (t) => [
  // Covers: WHERE project_id = ? ORDER BY relevance DESC (context fetch)
  index(""idx_ai_session_memories_project_rel"").on(t.projectId, t.relevance),
  // Covers: WHERE session_id = ? (write-back by session)
  index(""idx_ai_session_memories_session_id"").on(t.sessionId),
  // Covers task/project semantic retrieval before deterministic ranking.
  index(""idx_ai_session_memories_project_scope"").on(t.projectId, t.scope),
  // Covers: WHERE expires_at < NOW() (daily sweep)
  index(""idx_ai_session_memories_expires_at"").on(t.expiresAt),
  uniqueIndex(""uq_ai_session_memories_dedupe_key"").on(t.dedupeKey),
]);

export type InsertAiSessionMemory = typeof aiSessionMemoriesTable.$inferInsert;
export type AiSessionMemory = typeof aiSessionMemoriesTable.$inferSelect;

/**
 * Durable queue for memory writes produced by a successful chat turn.
 * The payload is intentionally plain data: it can be retried after a process
 * restart without replaying the model or trusting a later conversation state.
 */
export const aiSessionMemoryOutboxTable = pgTable(""ai_session_memory_outbox"", {
  id: text(""id"").primaryKey(),
  projectId: text(""project_id"")
    .notNull()
    .references(() => projectsTable.id, { onDelete: ""cascade"" }),
  sessionId: text(""session_id"")
    .notNull()
    .references(() => aiChatSessionsTable.id, { onDelete: ""cascade"" }),
  turnId: text(""turn_id"").notNull(),
  toolSources: jsonb(""tool_sources"").$type<string[]>().notNull().default([]),
  responseText: text(""response_text"").notNull(),
  /** Validated semantic records extracted before the durable write is queued. */
  semanticRecords: jsonb(""semantic_records"").$type<unknown[]>().notNull().default([]),
  attempts: integer(""attempts"").notNull().default(0),
  nextAttemptAt: timestamp(""next_attempt_at"").notNull(),
  createdAt: timestamp(""created_at"").notNull().defaultNow(),
}, (t) => [
  uniqueIndex(""uq_ai_session_memory_outbox_session_turn"").on(t.sessionId, t.turnId),
  index(""idx_ai_session_memory_outbox_next_attempt_at"").on(t.nextAttemptAt),
]);

export type InsertAiSessionMemoryOutbox = typeof aiSessionMemoryOutboxTable.$inferInsert;
export type AiSessionMemoryOutbox = typeof aiSessionMemoryOutboxTable.$inferSelect;

```",2026-09-19T21:01:34.550Z

```

## usage

```text
id,schema_version,project_id,user_id,execution_id,operation_id,correlation_id,attempt_id,provider,model,outcome,latency_ms,fallback_count,attempt_number,prompt_tokens,completion_tokens,usage_status,contract_outcome,recovery_outcome,contract_claim_count,contract_citation_match_count,contract_recovery_latency_ms,contract_failure_kind,provider_failure_kind,occurred_at,expires_at
ad2fed5a-5292-4777-af09-7acf8d13757d,1,7121328e-5960-4dae-b67e-221c90fee498,user_3JTrV1mgwquwF2g7zv8r8JdqeQs,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,b1458402-cb5e-4766-8d2c-f5388f1a8c89,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f:provider:openrouter:1,openrouter,cohere/north-mini-code:free,success,4500,0,1,,,unknown,not_applicable,not_attempted,0,0,,,,2026-09-19T21:01:34.435Z,2026-12-18T21:01:34.435Z
ca7f0fc9-979a-42af-b44b-22b903b79c43,1,7121328e-5960-4dae-b67e-221c90fee498,user_3JTrV1mgwquwF2g7zv8r8JdqeQs,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,b1458402-cb5e-4766-8d2c-f5388f1a8c89,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f:provider:openrouter:2,openrouter,cohere/north-mini-code:free,success,2809,0,2,,,unknown,not_applicable,not_attempted,0,0,,,,2026-09-19T21:01:34.448Z,2026-12-18T21:01:34.448Z
b5873a49-9a1d-4a7b-ad0a-76c89eb88c5a,1,7121328e-5960-4dae-b67e-221c90fee498,user_3JTrV1mgwquwF2g7zv8r8JdqeQs,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,b1458402-cb5e-4766-8d2c-f5388f1a8c89,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f:provider:openrouter:3,openrouter,cohere/north-mini-code:free,success,2829,0,3,,,unknown,not_applicable,not_attempted,0,0,,,,2026-09-19T21:01:34.454Z,2026-12-18T21:01:34.454Z
a51c69aa-dabb-485b-a680-bf9e26964fba,1,7121328e-5960-4dae-b67e-221c90fee498,user_3JTrV1mgwquwF2g7zv8r8JdqeQs,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,b1458402-cb5e-4766-8d2c-f5388f1a8c89,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f:provider:openrouter:4,openrouter,cohere/north-mini-code:free,failure,668,0,4,,,unknown,not_applicable,not_attempted,0,0,,,INVALID_PROVIDER_RESPONSE,2026-09-19T21:01:34.459Z,2026-12-18T21:01:34.459Z
ff34911f-8986-439b-a32d-00f8d68a92ee,1,7121328e-5960-4dae-b67e-221c90fee498,user_3JTrV1mgwquwF2g7zv8r8JdqeQs,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,b1458402-cb5e-4766-8d2c-f5388f1a8c89,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f:provider:openrouter:5,openrouter,poolside/laguna-s-2.1:free,success,1717,1,5,,,unknown,not_applicable,not_attempted,0,0,,,,2026-09-19T21:01:34.476Z,2026-12-18T21:01:34.476Z
ff6e31c8-165a-4d9d-a018-a74b27cfdce8,1,7121328e-5960-4dae-b67e-221c90fee498,user_3JTrV1mgwquwF2g7zv8r8JdqeQs,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,b1458402-cb5e-4766-8d2c-f5388f1a8c89,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f:provider:openrouter:6,openrouter,cohere/north-mini-code:free,success,5130,2,6,,,unknown,not_applicable,not_attempted,0,0,,,,2026-09-19T21:01:34.482Z,2026-12-18T21:01:34.482Z
8d3b7f35-ed05-497b-9e74-5041f7ce7616,1,7121328e-5960-4dae-b67e-221c90fee498,user_3JTrV1mgwquwF2g7zv8r8JdqeQs,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,b1458402-cb5e-4766-8d2c-f5388f1a8c89,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f:provider:openrouter:7,openrouter,liquid/lfm-2.5-2.6b:free,success,3181,3,7,,,unknown,not_applicable,not_attempted,0,0,,,,2026-09-19T21:01:34.488Z,2026-12-18T21:01:34.488Z
f49e6d9b-6a0d-443a-8fdf-fc2908d424d0,1,7121328e-5960-4dae-b67e-221c90fee498,user_3JTrV1mgwquwF2g7zv8r8JdqeQs,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f,b1458402-cb5e-4766-8d2c-f5388f1a8c89,fc9a9ee2-3402-4fbc-a95d-1e75e37b404f:provider:openrouter:8,openrouter,liquid/lfm-2.5-2.6b:free,success,4654,3,8,,,unknown,not_applicable,not_attempted,0,0,,,,2026-09-19T21:01:34.493Z,2026-12-18T21:01:34.493Z

```

## reservations

```text
Encountered an error executing SQL command: column "created_at" does not exist
```

