
const express = require('express');
const multer = require('multer');
const { google } = require('googleapis');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');

const app = express();
const upload = multer({ dest: 'uploads/' });
const PORT = process.env.PORT || 8080;

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
const GOOGLE_DRIVE_FOLDER_ID = process.env.GOOGLE_DRIVE_FOLDER_ID;

const auth = new google.auth.GoogleAuth({
  keyFile: 'service-account.json',
  scopes: ['https://www.googleapis.com/auth/drive'],
});

async function downloadFile(auth, fileId, destination) {
  const drive = google.drive({ version: 'v3', auth });
  const dest = fs.createWriteStream(destination);
  await drive.files.get({ fileId, alt: 'media' }, { responseType: 'stream' })
    .then(res => {
      return new Promise((resolve, reject) => {
        res.data
          .on('end', () => resolve())
          .on('error', err => reject(err))
          .pipe(dest);
      });
    });
}

async function uploadTextFile(auth, folderId, fileName, content) {
  const drive = google.drive({ version: 'v3', auth });
  const fileMetadata = { name: fileName, parents: [folderId] };
  const media = { mimeType: 'text/plain', body: content };
  const file = await drive.files.create({
    resource: fileMetadata,
    media: media,
    fields: 'id'
  });
  return file.data.id;
}

app.use(express.json());

app.post('/transcribe', async (req, res) => {
  const { fileId } = req.body;
  if (!fileId) return res.status(400).send({ error: 'Missing fileId' });

  try {
    const authClient = await auth.getClient();
    const tempFilePath = path.join(__dirname, 'uploads', `${fileId}.m4a`);
    await downloadFile(authClient, fileId, tempFilePath);

    const formData = new FormData();
    formData.append('file', fs.createReadStream(tempFilePath));
    formData.append('model_id', 'eleven_multilingual_v1');
    formData.append('language', 'ja');

    const response = await axios.post(
      'https://api.elevenlabs.io/v1/audio/transcriptions',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'xi-api-key': ELEVENLABS_API_KEY
        }
      }
    );

    const transcript = response.data.text;
    const transcriptFileName = `${fileId}.transcript.txt`;
    await uploadTextFile(authClient, GOOGLE_DRIVE_FOLDER_ID, transcriptFileName, transcript);
    fs.unlinkSync(tempFilePath);
    res.send({ result: transcript });

  } catch (err) {
    console.error(err);
    res.status(500).send({ error: 'Transcription failed' });
  }
});

app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
