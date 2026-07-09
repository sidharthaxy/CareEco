import { useEffect, useState } from 'react';

function App() {
  const [data, setData] = useState({ clientRecords: [], cloudRecords: [], deadLetterQueue: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('http://localhost:3000/api/data')
      .then(res => res.json())
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(err => {
        console.error(err);
        setLoading(false);
      });
  }, []);

  const renderTable = (title, records, expectedDesc) => (
    <div className="flex-1 bg-white p-6 rounded-xl shadow-lg border border-gray-100 flex flex-col h-full">
      <h2 className="text-xl font-bold mb-2 text-indigo-900 border-b-2 border-indigo-100 pb-2 flex items-center justify-between">
        {title}
        <span className="text-sm font-normal text-gray-500 bg-gray-100 px-3 py-1 rounded-full">{records.length} items</span>
      </h2>
      <p className="text-sm text-gray-600 mb-4 h-12">{expectedDesc}</p>
      
      <div className="overflow-auto flex-1">
        {records.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-gray-400">
            <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"></path></svg>
            <p>No records</p>
          </div>
        ) : (
          <table className="min-w-full text-sm text-left text-gray-600">
            <thead className="text-xs text-gray-700 uppercase bg-indigo-50/50 sticky top-0">
              <tr>
                <th className="px-4 py-3 font-semibold rounded-tl-lg">Payload / State</th>
                <th className="px-4 py-3 font-semibold">Modified By</th>
                <th className="px-4 py-3 font-semibold rounded-tr-lg">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {records.map((r, i) => (
                <tr key={i} className="hover:bg-indigo-50/30 transition-colors">
                  <td className="px-4 py-4">
                    <div className="font-mono text-xs bg-gray-100 px-2 py-1 rounded w-max mb-1 text-gray-800 border border-gray-200">
                      {JSON.stringify(r.payload)}
                    </div>
                    {r.reason && (
                      <div className="mt-2 text-xs font-medium text-red-600 flex items-start">
                        <span className="mr-1 mt-0.5">❌</span> {r.reason}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-4">
                    <div className="flex items-center gap-2">
                      <span className={`capitalize px-2 py-1 rounded text-xs font-semibold ${r.modified_by === 'desktop' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>
                        {r.modified_by}
                      </span>
                      {r.is_critical ? (
                        <span className="flex items-center gap-1 text-red-600 text-xs font-bold bg-red-50 px-2 py-1 rounded border border-red-100" title="Critical Override">
                          ⭐ Critical
                        </span>
                      ) : (
                        <span className="text-gray-400 text-xs">Standard</span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-4 text-xs">
                    <div className="text-gray-500 mb-1">
                      <span className="font-medium text-gray-700">Type:</span> {r.data_type}
                    </div>
                    <div className="text-gray-500">
                      <span className="font-medium text-gray-700">Time:</span> {new Date(r.last_modified_at).toLocaleTimeString()}
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <span className="text-green-600 font-bold">✅ Synced</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-10 font-sans">
      <header className="mb-10 max-w-7xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight flex items-center gap-3">
              <span className="bg-indigo-600 text-white p-2 rounded-lg shadow-sm">
                <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
              </span>
              Sync Data Visualization
            </h1>
            <p className="text-slate-600 mt-3 text-lg max-w-3xl">
              Visualizing the <strong className="text-indigo-600">Last-Write-Wins (LWW)</strong> engine. Notice how the critical desktop update overrides the mobile update, pushing the rejected mobile data into the Dead Letter Queue.
            </p>
          </div>
          <div className="hidden md:block bg-white p-4 rounded-xl shadow-sm border border-slate-200">
            <h3 className="text-sm font-bold text-slate-800 mb-2">Rules Applied:</h3>
            <ul className="text-xs text-slate-600 space-y-1">
              <li className="flex items-center gap-2"><span className="text-green-500">✔</span> Rule 1: Last-Write-Wins (Default)</li>
              <li className="flex items-center gap-2"><span className="text-red-500">⭐</span> Rule 2: Critical Desktop Overrides Mobile</li>
              <li className="flex items-center gap-2"><span className="text-purple-500">📥</span> Rule 3: Rejected updates go to DLQ</li>
            </ul>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="flex flex-col items-center justify-center h-64">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-600 mb-4"></div>
          <p className="text-slate-500 font-medium">Connecting to Sync Engine API on :3000...</p>
        </div>
      ) : (
        <div className="flex flex-col gap-6 max-w-4xl mx-auto">
          {renderTable(
            'Client Records (Local)', 
            data.clientRecords, 
            'Expected: Shows the winning Desktop record successfully written back to the local client database.'
          )}
          {renderTable(
            'Cloud Records (Remote)', 
            data.cloudRecords, 
            'Expected: Shows older cloud data, or the newly synced winning record from the client.'
          )}
          {renderTable(
            'Dead Letter Queue', 
            data.deadLetterQueue, 
            'Expected: Shows the rejected Mobile update. It lost because the Desktop update was flagged as Critical.'
          )}
        </div>
      )}
    </div>
  );
}

export default App;
