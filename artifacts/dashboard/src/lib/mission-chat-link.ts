type MissionOriginChatLinkInput = {
  projectId: string | null | undefined;
  missionId?: string | null;
  sessionId: string | null | undefined;
  messageId?: string | null;
};

function usableId(value: string | null | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function buildMissionOriginChatHref(
  input: MissionOriginChatLinkInput,
): string | null {
  if (
    !usableId(input.projectId)
    || !usableId(input.sessionId)
  ) {
    return null;
  }

  const params = new URLSearchParams();
  params.set('projectId', input.projectId);
  params.set('sessionId', input.sessionId);
  if (usableId(input.missionId)) params.set('missionId', input.missionId);
  if (usableId(input.messageId)) params.set('messageId', input.messageId);
  return `/ai?${params.toString()}`;
}
