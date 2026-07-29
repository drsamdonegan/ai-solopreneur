# Use documents and long transcripts

The Project Manager can use a document as source material for a request. This
is useful for meeting transcripts, project briefs, proposals, notes, and other
long text that would be awkward to fit in the normal message box.

## Add a file

1. Open [http://localhost:3000](http://localhost:3000).
2. Select the **+** inside the message box, then select **Upload a file**.
3. Choose one searchable PDF, Word `.docx`, or plain-text `.txt` file.
4. Wait for a removable document chip with its name and word count to appear
   inside the message box.
5. Enter a clear instruction in the message box.
6. Select **Send**.

After sending, the chip clears from the message box and a file preview appears
above the sent instruction in the conversation.

You can attach up to three documents to one request. Each uploaded file can be
up to 20 MB. Extracted text is limited to 150,000 characters per document and
200,000 characters across one request.

Older Word `.doc` files, rich-text `.rtf` files, spreadsheets, images, and
password-protected files are not accepted.

## Paste a long transcript

Select the **+** inside the message box, choose **Paste long text**, give the
text a useful name, paste up to 150,000 characters, then select **Add context**.

You can also paste directly into the normal message box. If the pasted section
is longer than 4,000 characters, the interface automatically prepares it as
document context and leaves the message box ready for your instruction.

## Good meeting instructions

Try:

- `Summarise the meeting in five bullets, then list confirmed decisions.`
- `Create an action-item table with action, owner, due date, and evidence. Write Not stated for missing details.`
- `Separate decisions, proposals, risks, dependencies, and open questions.`
- `Create a practical project plan from this brief, and label every inference.`

The meeting-analysis skill tells the agent not to invent missing owners or
deadlines and to separate source facts from inference.

## What happens to the document

The document reader extracts and normalises text inside an isolated local
Node.js process. The original file is not forwarded to n8n or Claude.

The chat stores extracted text in the Git-ignored `data/documents/` folder for
up to 24 hours so
it can attach that context to the conversation. Starting a new conversation
requests deletion of its attached records; expired records are also cleaned up
automatically. Resetting the local stack removes the extracted document data.

When you send a request, the selected extracted text is sent through the local
n8n workflow to the Claude API. Do not upload passwords, API keys, highly
sensitive personal information, or anything you are not permitted to send to
Anthropic.

Document text is treated as untrusted data. The n8n workflow wraps it in clear
boundaries and instructs the agent to ignore commands embedded inside it. This
reduces prompt-injection risk but cannot make arbitrary documents risk-free.

## Scanned PDFs

A searchable PDF contains selectable text. An image-only scan does not. This
version deliberately does not include optical character recognition (OCR).

If the chat reports that no readable text was found:

1. open the PDF and try selecting a sentence;
2. if selection is impossible, use trusted OCR software to create a searchable
   PDF or export the text;
3. review the converted text;
4. upload the searchable file or paste the text.

## If a document fails

Read the message shown in the conversation first. Common causes are:

- the file is an unsupported type;
- the file is larger than 20 MB;
- the extracted text is longer than 150,000 characters;
- a PDF is scanned, damaged, or password protected;
- a text file is not UTF-8;
- the local document reader has not finished starting.

Run the normal diagnostic, restart the stack, and retry. Technical helpers can
also run `node scripts/local.mjs logs documents`.
