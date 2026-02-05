import { useState, useRef, useCallback } from 'react';
import { useToast } from '../../components/common/Toast';
import ToolHeader from '../../components/Layout/ToolHeader';
import Footer from '../../components/Layout/Footer';

export default function ListNormalizerPage() {
  const showToast = useToast();
  const fileInputRef = useRef(null);

  const [step, setStep] = useState('upload');
  const [dragOver, setDragOver] = useState(false);
  const [originalCount, setOriginalCount] = useState(0);
  const [cleanedData, setCleanedData] = useState([]);
  const [removedCount, setRemovedCount] = useState(0);

  const processFile = useCallback((file) => {
    const validTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'text/csv',
    ];
    const validExtensions = ['.xlsx', '.xls', '.csv'];
    const extension = file.name.substring(file.name.lastIndexOf('.')).toLowerCase();

    if (!validTypes.includes(file.type) && !validExtensions.includes(extension)) {
      showToast('Please upload a valid .xlsx, .xls, or .csv file.', 'error');
      return;
    }

    setStep('processing');

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target.result);
        const workbook = window.XLSX.read(data, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = window.XLSX.utils.sheet_to_json(sheet);

        const cleaned = [];
        const count = rows.length;

        for (const row of rows) {
          const email = row['Email'] || row['email'] || row['EMAIL'] || row['E-mail'] || '';
          if (!email || !email.trim()) continue;

          const firstName = row['First Name'] || row['FirstName'] || row['first_name'] || row['First'] || '';
          const lastName = row['Last Name'] || row['LastName'] || row['last_name'] || row['Last'] || '';
          const fullName = row['Name'] || row['name'] || '';

          const name = fullName || `${firstName} ${lastName}`.trim();

          if (name && email.trim()) {
            cleaned.push({ NAME: name.trim(), EMAIL: email.trim().toLowerCase() });
          }
        }

        cleaned.sort((a, b) => a.NAME.localeCompare(b.NAME));

        setOriginalCount(count);
        setCleanedData(cleaned);
        setRemovedCount(count - cleaned.length);
        setStep('results');
      } catch (err) {
        showToast('Error processing file. Please check the format and try again.', 'error');
        setStep('upload');
      }
    };
    reader.onerror = () => {
      showToast('Error reading file. Please try again.', 'error');
      setStep('upload');
    };
    reader.readAsArrayBuffer(file);
  }, [showToast]);

  const handleFileChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, [processFile]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const downloadCSV = useCallback(() => {
    const csv = 'NAME,EMAIL\n' + cleanedData.map(r => `"${r.NAME}","${r.EMAIL}"`).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'normalized-list.csv';
    a.click();
    URL.revokeObjectURL(url);
  }, [cleanedData]);

  const downloadExcel = useCallback(() => {
    const ws = window.XLSX.utils.json_to_sheet(cleanedData);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Normalized');
    window.XLSX.writeFile(wb, 'normalized-list.xlsx');
  }, [cleanedData]);

  const startOver = useCallback(() => {
    setStep('upload');
    setOriginalCount(0);
    setCleanedData([]);
    setRemovedCount(0);
  }, []);

  return (
    <div className="tool-page">
      <ToolHeader title="List Normalizer" />

      <main className="tool-main">
        {step === 'upload' && (
          <div className="normalizer-upload-section">
            <div className="normalizer-hero">
              <span className="normalizer-hero-icon">&#x1F504;</span>
              <h1>Transform Your Customer Lists</h1>
              <p>Upload a BUMP Customers report and get a clean, Mailchimp-ready file in seconds.</p>
            </div>

            <div
              className={`normalizer-dropzone${dragOver ? ' drag-over' : ''}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <span className="normalizer-dropzone-icon">&#x1F4E4;</span>
              <p className="normalizer-dropzone-text">Drag and drop your Customers report here</p>
              <div className="normalizer-dropzone-divider">or</div>
              <button
                className="normalizer-browse-btn"
                onClick={() => fileInputRef.current?.click()}
              >
                Browse Files
              </button>
              <p className="normalizer-dropzone-hint">Accepts .xlsx, .xls, and .csv files</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
            </div>

            <div className="normalizer-info-cards">
              <div className="normalizer-info-card">
                <span className="normalizer-info-card-icon">&#x2728;</span>
                <h3>Auto-Formatted</h3>
                <p>Combines first and last names into a single NAME column</p>
              </div>
              <div className="normalizer-info-card">
                <span className="normalizer-info-card-icon">&#x1F9F9;</span>
                <h3>Clean Data</h3>
                <p>Removes entries without email addresses automatically</p>
              </div>
              <div className="normalizer-info-card">
                <span className="normalizer-info-card-icon">&#x1F4E7;</span>
                <h3>Mailchimp Ready</h3>
                <p>Exports NAME and EMAIL columns sorted and ready to import</p>
              </div>
            </div>
          </div>
        )}

        {step === 'processing' && (
          <div className="normalizer-processing">
            <div className="normalizer-spinner" />
            <p>Processing your list...</p>
          </div>
        )}

        {step === 'results' && (
          <div className="normalizer-results">
            <span className="normalizer-success-icon">&#x2705;</span>
            <h2>Your List is Ready!</h2>

            <div className="normalizer-stats">
              <div className="normalizer-stat">
                <span className="normalizer-stat-value">{originalCount}</span>
                <span className="normalizer-stat-label">Original Records</span>
              </div>
              <span className="normalizer-stat-arrow">&rarr;</span>
              <div className="normalizer-stat">
                <span className="normalizer-stat-value">{cleanedData.length}</span>
                <span className="normalizer-stat-label">Clean Records</span>
              </div>
              <div className="normalizer-stat removed">
                <span className="normalizer-stat-value">{removedCount}</span>
                <span className="normalizer-stat-label">Removed (No Email)</span>
              </div>
            </div>

            <div className="normalizer-preview">
              <table className="normalizer-preview-table">
                <thead>
                  <tr>
                    <th>NAME</th>
                    <th>EMAIL</th>
                  </tr>
                </thead>
                <tbody>
                  {cleanedData.slice(0, 10).map((row, i) => (
                    <tr key={i}>
                      <td>{row.NAME}</td>
                      <td>{row.EMAIL}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="normalizer-preview-count">
                Showing {Math.min(10, cleanedData.length)} of {cleanedData.length} records
              </p>
            </div>

            <div className="normalizer-actions">
              <button className="normalizer-btn primary" onClick={downloadCSV}>
                Download CSV
              </button>
              <button className="normalizer-btn secondary" onClick={downloadExcel}>
                Download Excel
              </button>
              <button className="normalizer-btn outline" onClick={startOver}>
                Start Over
              </button>
            </div>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
