import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';

const app = express();
const port = 3000;
const stateFile = path.join(__dirname, '..', 'test-state.json');

app.use(cors());
app.use(express.json());

app.get('/api/data', (req, res) => {
  if (fs.existsSync(stateFile)) {
    try {
      const data = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return res.json(data);
    } catch (e) {
      console.error('Error reading state file:', e);
    }
  }

  // Return empty state by default
  res.json({
    clientRecords: [],
    cloudRecords: [],
    deadLetterQueue: []
  });
});

app.delete('/api/data', (req, res) => {
  if (fs.existsSync(stateFile)) {
    fs.unlinkSync(stateFile);
  }
  res.json({ success: true });
});

app.listen(port, () => {
  console.log(`Backend API serving dynamic test data at http://localhost:${port}`);
});
