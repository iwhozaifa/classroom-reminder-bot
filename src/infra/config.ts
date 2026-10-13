// Script Properties are the only place secrets live (see CLAUDE.md) — this is the
// one module that reads/writes them, so every adapter that needs a secret takes it
// as a constructor argument instead of touching PropertiesService itself.

export interface ScriptSecrets {
  slackBotToken: string;
  slackUserId: string;
  /** Cached by the bot after its first conversations.open call — see SlackNotifier.getDmChannelId(). */
  slackDmChannelId: string | null;
  sheetId: string;
}

export function loadScriptSecrets(): ScriptSecrets {
  const properties = PropertiesService.getScriptProperties();
  return {
    slackBotToken: requireProperty(properties, 'SLACK_BOT_TOKEN'),
    slackUserId: requireProperty(properties, 'SLACK_USER_ID'),
    slackDmChannelId: properties.getProperty('SLACK_DM_CHANNEL_ID'),
    sheetId: requireProperty(properties, 'SHEET_ID'),
  };
}

/** Called once the orchestrator sees SlackNotifier resolve a DM channel id it didn't already have. */
export function saveSlackDmChannelId(channelId: string): void {
  PropertiesService.getScriptProperties().setProperty('SLACK_DM_CHANNEL_ID', channelId);
}

export interface PushSettings {
  /** Shared secret the Pub/Sub push endpoint URL carries as `?token=` — see triggers/pushSync.ts. */
  verificationToken: string;
  /** `projects/<project>/topics/<topic>` that Classroom registrations publish to. */
  topicName: string;
}

/** Read only by the push path, so a sweep-only install doesn't need these set. */
export function loadPushSettings(): PushSettings {
  const properties = PropertiesService.getScriptProperties();
  return {
    verificationToken: requireProperty(properties, 'PUSH_VERIFICATION_TOKEN'),
    topicName: requireProperty(properties, 'PUBSUB_TOPIC'),
  };
}

/**
 * Non-secret bookkeeping (per-course sync-start marks for pushSync.ts) also lives in
 * Script Properties, so this stays the one module that touches PropertiesService.
 */
export function scriptPropertiesKeyValueStore(): {
  get(key: string): string | null;
  set(key: string, value: string): void;
} {
  const properties = PropertiesService.getScriptProperties();
  return {
    get: (key) => properties.getProperty(key),
    set: (key, value) => {
      properties.setProperty(key, value);
    },
  };
}

function requireProperty(properties: GoogleAppsScript.Properties.Properties, key: string): string {
  const value = properties.getProperty(key);
  if (!value) throw new Error(`Script Property ${key} is not set.`);
  return value;
}
