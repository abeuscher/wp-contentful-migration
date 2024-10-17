const contentful = require('contentful-management');
const TurndownService = require('turndown');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = contentful.createClient({
  accessToken: process.env.CONTENTFUL_MANAGEMENT_TOKEN
});

const turndownService = new TurndownService();
const LOG_FILE_PATH = path.join(__dirname, 'html-to-markdown.log');

function getProcessedEntryIds() {
  if (fs.existsSync(LOG_FILE_PATH)) {
    const logData = fs.readFileSync(LOG_FILE_PATH, 'utf8');
    return logData.split('\n').filter(Boolean);
  }
  return [];
}

function logProcessedEntryId(entryId) {
  fs.appendFileSync(LOG_FILE_PATH, `${entryId}\n`);
}

async function fetchEntries() {
  const space = await client.getSpace(process.env.CONTENTFUL_SPACE_ID);
  const environment = await space.getEnvironment('master');
  const entries = await environment.getEntries({
    content_type: 'scores'
  });
  return entries.items.filter(entry => 
    entry.fields.strength_notes || entry.fields.taste_notes || 
    entry.fields.quality_notes || entry.fields.overall_notes
  );
}

function convertHtmlToMarkdown(htmlContent) {
  return turndownService.turndown(htmlContent);
}

async function updateEntry(entry, markdownContent, fieldId) {
  let retry = 3;
  while (retry > 0) {
    try {
      const space = await client.getSpace(process.env.CONTENTFUL_SPACE_ID);
      const environment = await space.getEnvironment('master');
      const freshEntry = await environment.getEntry(entry.sys.id);

      freshEntry.fields[fieldId]['en-US'] = markdownContent;
      const updatedEntry = await freshEntry.update();
      await updatedEntry.publish();

      console.log(`Successfully updated entry ${entry.sys.id}`);
      return;
    } catch (error) {
      if (error.name === 'VersionMismatch' && retry > 0) {
        console.log(`Version conflict on entry ${entry.sys.id}, retrying...`);
        retry--;
      } else {
        throw error;
      }
    }
  }
}

async function processEntries() {
  const processedEntryIds = getProcessedEntryIds();
  const entries = await fetchEntries();

  for (const entry of entries) {
    const entryId = entry.sys.id;

    if (processedEntryIds.includes(entryId)) {
      console.log(`Skipping entry ${entryId}, already processed.`);
      continue;
    }

    let updated = false;

    const strengthNotesHtml = entry.fields.strength_notes?.['en-US'];
    const tasteNotesHtml = entry.fields.taste_notes?.['en-US'];
    const qualityNotesHtml = entry.fields.quality_notes?.['en-US'];
    const overallNotesHtml = entry.fields.overall_notes?.['en-US'];

    if (strengthNotesHtml) {
      const markdownStrengthNotes = convertHtmlToMarkdown(strengthNotesHtml);
      await updateEntry(entry, markdownStrengthNotes, 'strength_notes');
      updated = true;
    }

    if (tasteNotesHtml) {
      const markdownTasteNotes = convertHtmlToMarkdown(tasteNotesHtml);
      await updateEntry(entry, markdownTasteNotes, 'taste_notes');
      updated = true;
    }

    if (qualityNotesHtml) {
      const markdownQualityNotes = convertHtmlToMarkdown(qualityNotesHtml);
      await updateEntry(entry, markdownQualityNotes, 'quality_notes');
      updated = true;
    }

    if (overallNotesHtml) {
      const markdownOverallNotes = convertHtmlToMarkdown(overallNotesHtml);
      await updateEntry(entry, markdownOverallNotes, 'overall_notes');
      updated = true;
    }

    if (updated) {
      console.log(`Updated entry ${entryId}`);
      logProcessedEntryId(entryId);
    } else {
      console.log(`No HTML to convert for entry ${entryId}`);
    }

    await new Promise(resolve => setTimeout(resolve, 1000));
  }
}

processEntries();
