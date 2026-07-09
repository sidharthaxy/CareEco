import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

const app = express();
const port = 3000;

app.use(cors());
app.use(express.json());

app.get('/api/data', (req, res) => {
  const commonTenant = randomUUID();

  // Mock data for visualization
  const clientRecords = [
    {
      id: randomUUID(),
      tenant_id: commonTenant,
      payload: { value: "Desktop update" },
      data_type: "transactional",
      last_modified_at: new Date().toISOString(),
      modified_by: "desktop",
      is_critical: true
    }
  ];

  const cloudRecords = [
    {
      id: randomUUID(),
      tenant_id: commonTenant,
      payload: { value: "Old Cloud Data" },
      data_type: "reference",
      last_modified_at: new Date(Date.now() - 10000).toISOString(),
      modified_by: "mobile",
      is_critical: false
    }
  ];

  const deadLetterQueue = [
    {
      id: clientRecords[0].id,
      tenant_id: commonTenant,
      payload: { value: "Rejected Mobile Update" },
      data_type: "transactional",
      last_modified_at: new Date(Date.now() + 5000).toISOString(),
      modified_by: "mobile",
      is_critical: false,
      reason: "Mobile update rejected due to critical desktop override",
      rejected_at: new Date().toISOString()
    }
  ];

  res.json({
    clientRecords,
    cloudRecords,
    deadLetterQueue
  });
});

app.listen(port, () => {
  console.log(`Backend API serving mock data at http://localhost:${port}`);
});
