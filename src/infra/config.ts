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

function requireProperty(properties: GoogleAppsScript.Properties.Properties, key: string): string {
  const value = properties.getProperty(key);
  if (!value) throw new Error(`Script Property ${key} is not set.`);
  return value;
}
