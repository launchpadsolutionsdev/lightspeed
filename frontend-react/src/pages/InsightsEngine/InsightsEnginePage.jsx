import { useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '../../components/common/Toast';
import ToolHeader from '../../components/Layout/ToolHeader';
import Footer from '../../components/Layout/Footer';

const REPORT_TYPES = {
  'Customer Purchases': 'Analyze purchasing patterns, revenue by tier, geographic distribution, and identify top buyers.',
  Customers: 'Analyze customer demographics, geographic distribution, and contact information.',
  'Payment Tickets': 'Analyze payment methods, in-person vs online sales, and seller performance by location.',
  Sellers: 'Analyze seller performance, sales by method, and identify top and underperforming locations.',
};

function formatCurrency(value) {
  if (value == null || isNaN(value)) return '$0.00';
  return '$' + Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatNumber(value) {
  if (value == null || isNaN(value)) return '0';
  return Number(value).toLocaleString('en-US');
}

/* ---------------------------------------------------------------------------
   Stat computation helpers — one function per report type
   --------------------------------------------------------------------------- */

function computeCustomerPurchasesStats(rows) {
  const revenueCol = findColumn(rows, ['total', 'revenue', 'amount', 'price', 'sales', 'spent']);
  const tierCol = findColumn(rows, ['tier', 'level', 'membership', 'segment']);
  const cityCol = findColumn(rows, ['city', 'location', 'region', 'area', 'state']);
  const methodCol = findColumn(rows, ['method', 'payment', 'payment method', 'pay type']);

  const revenues = revenueCol ? rows.map((r) => parseFloat(r[revenueCol]) || 0) : [];
  const totalRevenue = revenues.reduce((s, v) => s + v, 0);
  const avgOrder = revenues.length ? totalRevenue / revenues.length : 0;

  const tierBreakdown = groupCount(rows, tierCol);
  const cityBreakdown = groupSum(rows, cityCol, revenueCol);
  const methodBreakdown = groupCount(rows, methodCol);

  return {
    cards: [
      { label: 'Total Revenue', value: formatCurrency(totalRevenue) },
      { label: 'Total Orders', value: formatNumber(rows.length) },
      { label: 'Avg Order Value', value: formatCurrency(avgOrder) },
      { label: 'Unique Tiers', value: formatNumber(Object.keys(tierBreakdown).length || '-') },
    ],
    tierBreakdown,
    cityBreakdown,
    methodBreakdown,
    revenueCol,
    tierCol,
    cityCol,
    methodCol,
  };
}

function computeCustomersStats(rows) {
  const cityCol = findColumn(rows, ['city', 'location', 'region', 'area', 'state']);
  const emailCol = findColumn(rows, ['email', 'e-mail']);
  const cityBreakdown = groupCount(rows, cityCol);

  const withEmail = emailCol ? rows.filter((r) => r[emailCol]).length : rows.length;

  return {
    cards: [
      { label: 'Total Customers', value: formatNumber(rows.length) },
      { label: 'Cities Represented', value: formatNumber(Object.keys(cityBreakdown).length) },
      { label: 'With Email', value: formatNumber(withEmail) },
      { label: 'Missing Email', value: formatNumber(rows.length - withEmail) },
    ],
    cityBreakdown,
    cityCol,
  };
}

function computePaymentTicketsStats(rows) {
  const amountCol = findColumn(rows, ['total', 'amount', 'revenue', 'price', 'sales']);
  const methodCol = findColumn(rows, ['method', 'payment', 'payment method', 'type']);
  const channelCol = findColumn(rows, ['channel', 'source', 'in-person', 'online', 'sale type']);
  const sellerCol = findColumn(rows, ['seller', 'agent', 'rep', 'employee', 'staff']);
  const cityCol = findColumn(rows, ['city', 'location', 'region', 'area', 'state']);

  const amounts = amountCol ? rows.map((r) => parseFloat(r[amountCol]) || 0) : [];
  const total = amounts.reduce((s, v) => s + v, 0);
  const methodBreakdown = groupCount(rows, methodCol);
  const channelBreakdown = groupCount(rows, channelCol);
  const sellerBreakdown = groupSum(rows, sellerCol, amountCol);

  return {
    cards: [
      { label: 'Total Sales', value: formatCurrency(total) },
      { label: 'Total Tickets', value: formatNumber(rows.length) },
      { label: 'Payment Methods', value: formatNumber(Object.keys(methodBreakdown).length) },
      { label: 'Avg Ticket', value: formatCurrency(amounts.length ? total / amounts.length : 0) },
    ],
    methodBreakdown,
    channelBreakdown,
    sellerBreakdown,
    amountCol,
    methodCol,
    channelCol,
    sellerCol,
    cityCol,
  };
}

function computeSellersStats(rows) {
  const salesCol = findColumn(rows, ['total', 'sales', 'revenue', 'amount']);
  const methodCol = findColumn(rows, ['method', 'sales method', 'type']);
  const cityCol = findColumn(rows, ['city', 'location', 'region', 'area', 'state']);
  const nameCol = findColumn(rows, ['name', 'seller', 'agent', 'rep', 'employee']);

  const sales = salesCol ? rows.map((r) => parseFloat(r[salesCol]) || 0) : [];
  const total = sales.reduce((s, v) => s + v, 0);
  const avg = sales.length ? total / sales.length : 0;
  const max = sales.length ? Math.max(...sales) : 0;
  const min = sales.length ? Math.min(...sales) : 0;

  const cityBreakdown = groupSum(rows, cityCol, salesCol);
  const methodBreakdown = groupCount(rows, methodCol);

  return {
    cards: [
      { label: 'Total Revenue', value: formatCurrency(total) },
      { label: 'Total Sellers', value: formatNumber(rows.length) },
      { label: 'Avg Revenue', value: formatCurrency(avg) },
      { label: 'Top Performer', value: formatCurrency(max) },
    ],
    cityBreakdown,
    methodBreakdown,
    salesCol,
    methodCol,
    cityCol,
    nameCol,
    minSales: min,
    maxSales: max,
  };
}

/* ---------------------------------------------------------------------------
   Column & grouping utilities
   --------------------------------------------------------------------------- */

function findColumn(rows, keywords) {
  if (!rows.length) return null;
  const cols = Object.keys(rows[0]);
  for (const kw of keywords) {
    const match = cols.find((c) => c.toLowerCase().includes(kw.toLowerCase()));
    if (match) return match;
  }
  return null;
}

function groupCount(rows, col) {
  if (!col) return {};
  const map = {};
  rows.forEach((r) => {
    const key = String(r[col] || 'Unknown').trim();
    map[key] = (map[key] || 0) + 1;
  });
  return map;
}

function groupSum(rows, groupCol, sumCol) {
  if (!groupCol || !sumCol) return {};
  const map = {};
  rows.forEach((r) => {
    const key = String(r[groupCol] || 'Unknown').trim();
    map[key] = (map[key] || 0) + (parseFloat(r[sumCol]) || 0);
  });
  return map;
}

/* ---------------------------------------------------------------------------
   Chart color palette
   --------------------------------------------------------------------------- */

const CHART_COLORS = [
  'rgba(99,102,241,0.8)',
  'rgba(236,72,153,0.8)',
  'rgba(16,185,129,0.8)',
  'rgba(245,158,11,0.8)',
  'rgba(139,92,246,0.8)',
  'rgba(14,165,233,0.8)',
  'rgba(244,63,94,0.8)',
  'rgba(34,197,94,0.8)',
  'rgba(249,115,22,0.8)',
  'rgba(168,85,247,0.8)',
];

const CHART_BORDERS = CHART_COLORS.map((c) => c.replace('0.8', '1'));

/* ===========================================================================
   Main Component
   =========================================================================== */

export default function InsightsEnginePage() {
  const showToast = useToast();

  // Upload state
  const [reportType, setReportType] = useState('');
  const [file, setFile] = useState(null);
  const [reportName, setReportName] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  // Results state
  const [data, setData] = useState(null);
  const [columns, setColumns] = useState([]);
  const [stats, setStats] = useState(null);
  const [activeTab, setActiveTab] = useState('overview');

  // Chart refs
  const barChartRef = useRef(null);
  const barChartInstance = useRef(null);
  const pieChartRef = useRef(null);
  const pieChartInstance = useRef(null);

  const fileInputRef = useRef(null);

  // ---- File parsing ----
  const parseFile = useCallback(
    (selectedFile) => {
      if (!selectedFile) return;

      const validExtensions = ['.xlsx', '.xls', '.csv'];
      const ext = selectedFile.name.substring(selectedFile.name.lastIndexOf('.')).toLowerCase();
      if (!validExtensions.includes(ext)) {
        showToast('Please upload a valid .xlsx, .xls, or .csv file.', 'error');
        return;
      }

      setFile(selectedFile);

      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const XLSX = window.XLSX;
          if (!XLSX) {
            showToast('SheetJS library not loaded. Please refresh and try again.', 'error');
            return;
          }

          const arrayBuffer = e.target.result;
          const workbook = XLSX.read(arrayBuffer, { type: 'array' });
          const firstSheetName = workbook.SheetNames[0];
          const sheet = workbook.Sheets[firstSheetName];
          const jsonData = XLSX.utils.sheet_to_json(sheet);

          if (!jsonData.length) {
            showToast('The uploaded file contains no data rows.', 'error');
            return;
          }

          const cols = Object.keys(jsonData[0]);
          setColumns(cols);
          setData(jsonData);

          // Compute stats based on report type
          let computed = null;
          switch (reportType) {
            case 'Customer Purchases':
              computed = computeCustomerPurchasesStats(jsonData);
              break;
            case 'Customers':
              computed = computeCustomersStats(jsonData);
              break;
            case 'Payment Tickets':
              computed = computePaymentTicketsStats(jsonData);
              break;
            case 'Sellers':
              computed = computeSellersStats(jsonData);
              break;
            default:
              computed = { cards: [{ label: 'Total Rows', value: formatNumber(jsonData.length) }] };
          }
          setStats(computed);
          setActiveTab('overview');
          showToast('File parsed successfully! Your dashboard is ready.', 'success');
        } catch (err) {
          console.error('Parse error:', err);
          showToast('Failed to parse the file. Please ensure it is a valid spreadsheet.', 'error');
        }
      };
      reader.readAsArrayBuffer(selectedFile);
    },
    [reportType, showToast]
  );

  // ---- Drag & drop handlers ----
  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleDrop = useCallback(
    (e) => {
      e.preventDefault();
      setIsDragging(false);
      const droppedFile = e.dataTransfer.files?.[0];
      if (droppedFile) parseFile(droppedFile);
    },
    [parseFile]
  );

  const handleFileSelect = useCallback(
    (e) => {
      const selectedFile = e.target.files?.[0];
      if (selectedFile) parseFile(selectedFile);
    },
    [parseFile]
  );

  // ---- Reset ----
  const handleNewReport = useCallback(() => {
    setReportType('');
    setFile(null);
    setReportName('');
    setData(null);
    setColumns([]);
    setStats(null);
    setActiveTab('overview');
    setIsDragging(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  // ---- Charts ----
  useEffect(() => {
    if (!data || !stats || activeTab !== 'overview') return;
    const Chart = window.Chart;
    if (!Chart) return;

    // Bar chart
    if (barChartRef.current) {
      if (barChartInstance.current) barChartInstance.current.destroy();

      let barLabels = [];
      let barValues = [];
      let barTitle = 'Breakdown';

      if (reportType === 'Customer Purchases' && stats.tierBreakdown) {
        barLabels = Object.keys(stats.tierBreakdown);
        barTitle = 'Revenue by Tier';
        // If we have grouped revenue by tier, use summed values; otherwise use counts
        if (stats.tierCol && stats.revenueCol) {
          const tierRevenue = {};
          data.forEach((r) => {
            const tier = String(r[stats.tierCol] || 'Unknown').trim();
            tierRevenue[tier] = (tierRevenue[tier] || 0) + (parseFloat(r[stats.revenueCol]) || 0);
          });
          barLabels = Object.keys(tierRevenue);
          barValues = Object.values(tierRevenue);
        } else {
          barValues = Object.values(stats.tierBreakdown);
        }
      } else if (reportType === 'Customers' && stats.cityBreakdown) {
        const sorted = Object.entries(stats.cityBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 15);
        barLabels = sorted.map((e) => e[0]);
        barValues = sorted.map((e) => e[1]);
        barTitle = 'Customers by City';
      } else if (reportType === 'Payment Tickets' && stats.channelBreakdown) {
        barLabels = Object.keys(stats.channelBreakdown);
        barValues = Object.values(stats.channelBreakdown);
        barTitle = 'Tickets by Channel';
      } else if (reportType === 'Sellers' && stats.cityBreakdown) {
        const sorted = Object.entries(stats.cityBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 15);
        barLabels = sorted.map((e) => e[0]);
        barValues = sorted.map((e) => e[1]);
        barTitle = 'Revenue by Location';
      }

      if (barLabels.length) {
        barChartInstance.current = new Chart(barChartRef.current, {
          type: 'bar',
          data: {
            labels: barLabels,
            datasets: [
              {
                label: barTitle,
                data: barValues,
                backgroundColor: CHART_COLORS.slice(0, barLabels.length),
                borderColor: CHART_BORDERS.slice(0, barLabels.length),
                borderWidth: 1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              title: { display: true, text: barTitle, font: { size: 16 } },
            },
            scales: {
              y: { beginAtZero: true },
            },
          },
        });
      }
    }

    // Pie chart
    if (pieChartRef.current) {
      if (pieChartInstance.current) pieChartInstance.current.destroy();

      let pieLabels = [];
      let pieValues = [];
      let pieTitle = 'Distribution';

      if (reportType === 'Customer Purchases' && stats.methodBreakdown) {
        pieLabels = Object.keys(stats.methodBreakdown);
        pieValues = Object.values(stats.methodBreakdown);
        pieTitle = 'Payment Methods';
      } else if (reportType === 'Customers' && stats.cityBreakdown) {
        const sorted = Object.entries(stats.cityBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 8);
        pieLabels = sorted.map((e) => e[0]);
        pieValues = sorted.map((e) => e[1]);
        pieTitle = 'Top Cities';
      } else if (reportType === 'Payment Tickets' && stats.methodBreakdown) {
        pieLabels = Object.keys(stats.methodBreakdown);
        pieValues = Object.values(stats.methodBreakdown);
        pieTitle = 'Payment Methods';
      } else if (reportType === 'Sellers' && stats.methodBreakdown) {
        pieLabels = Object.keys(stats.methodBreakdown);
        pieValues = Object.values(stats.methodBreakdown);
        pieTitle = 'Sales Methods';
      }

      if (pieLabels.length) {
        pieChartInstance.current = new Chart(pieChartRef.current, {
          type: 'pie',
          data: {
            labels: pieLabels,
            datasets: [
              {
                data: pieValues,
                backgroundColor: CHART_COLORS.slice(0, pieLabels.length),
                borderColor: CHART_BORDERS.slice(0, pieLabels.length),
                borderWidth: 1,
              },
            ],
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              title: { display: true, text: pieTitle, font: { size: 16 } },
              legend: { position: 'bottom' },
            },
          },
        });
      }
    }

    return () => {
      if (barChartInstance.current) barChartInstance.current.destroy();
      if (pieChartInstance.current) pieChartInstance.current.destroy();
    };
  }, [data, stats, activeTab, reportType]);

  // ---- Heat map data ----
  const heatMapData = (() => {
    if (!data || !stats) return [];
    const cityCol =
      stats.cityCol ||
      findColumn(data, ['city', 'location', 'region', 'area', 'state']);
    if (!cityCol) return [];

    const grouped = {};
    data.forEach((r) => {
      const key = String(r[cityCol] || 'Unknown').trim();
      if (!grouped[key]) grouped[key] = { city: key, count: 0, rows: [] };
      grouped[key].count += 1;
      grouped[key].rows.push(r);
    });

    const entries = Object.values(grouped).sort((a, b) => b.count - a.count);
    const maxCount = entries.length ? entries[0].count : 1;
    return entries.map((e) => ({ ...e, intensity: e.count / maxCount }));
  })();

  // ---- Top buyers (Customer Purchases only) ----
  const topBuyers = (() => {
    if (reportType !== 'Customer Purchases' || !data || !stats) return [];
    const nameCol = findColumn(data, ['name', 'customer', 'buyer', 'client']);
    const revenueCol = stats.revenueCol;
    if (!nameCol || !revenueCol) return [];

    const buyerMap = {};
    data.forEach((r) => {
      const name = String(r[nameCol] || 'Unknown').trim();
      if (!buyerMap[name]) buyerMap[name] = { name, totalSpent: 0, orders: 0 };
      buyerMap[name].totalSpent += parseFloat(r[revenueCol]) || 0;
      buyerMap[name].orders += 1;
    });

    return Object.values(buyerMap)
      .sort((a, b) => b.totalSpent - a.totalSpent)
      .slice(0, 20);
  })();

  // ---- Determine whether we are showing upload vs results ----
  const showResults = data && stats;

  // ---- Tab definitions ----
  const tabs = [
    { id: 'overview', label: 'Overview', icon: '\uD83D\uDCCA' },
    { id: 'heatmap', label: 'Heat Map', icon: '\uD83D\uDDFA\uFE0F' },
  ];
  if (reportType === 'Customer Purchases') {
    tabs.push({ id: 'topbuyers', label: 'Top Buyers', icon: '\uD83D\uDC33' });
  }

  return (
    <div className="tool-page">
      <ToolHeader title="Insights Engine">
        {showResults && (
          <button className="btn btn-secondary" onClick={handleNewReport}>
            New Report
          </button>
        )}
      </ToolHeader>

      <main className="tool-main" style={{ padding: '24px', maxWidth: 1200, margin: '0 auto', width: '100%' }}>
        {!showResults ? (
          /* =========================  UPLOAD STATE  ========================= */
          <div className="data-combined-upload-section">
            {/* Step 1 — Report Type */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 32,
                    height: 32,
                    borderRadius: '50%',
                    background: 'var(--primary, #6366f1)',
                    color: '#fff',
                    fontWeight: 700,
                    fontSize: 14,
                  }}
                >
                  1
                </span>
                <h3 style={{ margin: 0 }}>Select Report Type</h3>
              </div>

              <select
                value={reportType}
                onChange={(e) => setReportType(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 14px',
                  borderRadius: 8,
                  border: '1px solid var(--border, #e2e8f0)',
                  fontSize: 15,
                  background: 'var(--surface, #fff)',
                  color: 'inherit',
                }}
              >
                <option value="">-- Choose a report type --</option>
                {Object.keys(REPORT_TYPES).map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>

              {reportType && (
                <p style={{ marginTop: 10, fontSize: 14, opacity: 0.7 }}>
                  {REPORT_TYPES[reportType]}
                </p>
              )}
            </div>

            {/* Step 2 — File Upload (visible after report type selected) */}
            {reportType && (
              <div style={{ marginBottom: 32 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: 'var(--primary, #6366f1)',
                      color: '#fff',
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    2
                  </span>
                  <h3 style={{ margin: 0 }}>Upload Your Report</h3>
                </div>

                <div
                  className={`data-upload-dropzone${isDragging ? ' dragging' : ''}`}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  style={{
                    border: '2px dashed var(--border, #cbd5e1)',
                    borderRadius: 12,
                    padding: '48px 24px',
                    textAlign: 'center',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s, background 0.2s',
                    background: isDragging ? 'rgba(99,102,241,0.05)' : 'transparent',
                    borderColor: isDragging ? 'var(--primary, #6366f1)' : undefined,
                  }}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div style={{ fontSize: 48, marginBottom: 12 }}>{'\uD83D\uDCE4'}</div>
                  <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>
                    Drag and drop your Excel file here
                  </p>
                  <p style={{ fontSize: 14, opacity: 0.5, marginBottom: 16 }}>or</p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ marginBottom: 12 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      fileInputRef.current?.click();
                    }}
                  >
                    Browse Files
                  </button>
                  <p style={{ fontSize: 13, opacity: 0.5 }}>Supports .xlsx, .xls, and .csv files</p>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    style={{ display: 'none' }}
                    onChange={handleFileSelect}
                  />
                </div>

                {/* Show selected filename */}
                {file && (
                  <p style={{ marginTop: 12, fontSize: 14 }}>
                    Selected: <strong>{file.name}</strong>
                  </p>
                )}
              </div>
            )}

            {/* Optional naming section — shown after file loaded */}
            {file && (
              <div style={{ marginBottom: 32 }}>
                <label style={{ display: 'block', fontSize: 14, fontWeight: 500, marginBottom: 8 }}>
                  Name this report <span style={{ opacity: 0.5, fontWeight: 400 }}>(optional)</span>
                </label>
                <input
                  type="text"
                  value={reportName}
                  onChange={(e) => setReportName(e.target.value)}
                  placeholder="e.g. Q4 2025 Customer Analysis"
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    borderRadius: 8,
                    border: '1px solid var(--border, #e2e8f0)',
                    fontSize: 15,
                    background: 'var(--surface, #fff)',
                    color: 'inherit',
                  }}
                />
              </div>
            )}
          </div>
        ) : (
          /* =========================  RESULTS STATE  ========================= */
          <div>
            {/* Report name / type header */}
            <div style={{ marginBottom: 24 }}>
              <h2 style={{ margin: 0 }}>
                {reportName || reportType} Dashboard
              </h2>
              <p style={{ margin: '4px 0 0', fontSize: 14, opacity: 0.6 }}>
                {reportType} &middot; {formatNumber(data.length)} rows &middot; {columns.length} columns
                {file ? ` \u00B7 ${file.name}` : ''}
              </p>
            </div>

            {/* Navigation tabs */}
            <div
              style={{
                display: 'flex',
                gap: 4,
                marginBottom: 24,
                borderBottom: '2px solid var(--border, #e2e8f0)',
                paddingBottom: 0,
              }}
            >
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  style={{
                    padding: '10px 20px',
                    background: 'none',
                    border: 'none',
                    borderBottom: activeTab === tab.id ? '2px solid var(--primary, #6366f1)' : '2px solid transparent',
                    marginBottom: -2,
                    cursor: 'pointer',
                    fontSize: 14,
                    fontWeight: activeTab === tab.id ? 600 : 400,
                    color: activeTab === tab.id ? 'var(--primary, #6366f1)' : 'inherit',
                    opacity: activeTab === tab.id ? 1 : 0.6,
                    transition: 'all 0.2s',
                  }}
                >
                  <span style={{ marginRight: 6 }}>{tab.icon}</span>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* ---------- Overview Tab ---------- */}
            {activeTab === 'overview' && (
              <div>
                {/* Stats cards */}
                <div
                  className="data-stats-grid"
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: 16,
                    marginBottom: 32,
                  }}
                >
                  {stats.cards.map((card, idx) => (
                    <div
                      key={idx}
                      style={{
                        padding: '20px 24px',
                        borderRadius: 12,
                        border: '1px solid var(--border, #e2e8f0)',
                        background: 'var(--surface, #fff)',
                      }}
                    >
                      <div style={{ fontSize: 13, opacity: 0.6, marginBottom: 4 }}>{card.label}</div>
                      <div style={{ fontSize: 24, fontWeight: 700 }}>{card.value}</div>
                    </div>
                  ))}
                </div>

                {/* Charts */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
                    gap: 24,
                    marginBottom: 32,
                  }}
                >
                  <div
                    style={{
                      padding: 20,
                      borderRadius: 12,
                      border: '1px solid var(--border, #e2e8f0)',
                      background: 'var(--surface, #fff)',
                      height: 360,
                    }}
                  >
                    <canvas ref={barChartRef} />
                  </div>
                  <div
                    style={{
                      padding: 20,
                      borderRadius: 12,
                      border: '1px solid var(--border, #e2e8f0)',
                      background: 'var(--surface, #fff)',
                      height: 360,
                    }}
                  >
                    <canvas ref={pieChartRef} />
                  </div>
                </div>

                {/* Data table */}
                <div
                  style={{
                    borderRadius: 12,
                    border: '1px solid var(--border, #e2e8f0)',
                    overflow: 'auto',
                    maxHeight: 480,
                  }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr>
                        {columns.map((col) => (
                          <th
                            key={col}
                            style={{
                              position: 'sticky',
                              top: 0,
                              padding: '10px 14px',
                              textAlign: 'left',
                              background: 'var(--surface-alt, #f8fafc)',
                              borderBottom: '2px solid var(--border, #e2e8f0)',
                              whiteSpace: 'nowrap',
                              fontWeight: 600,
                            }}
                          >
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.slice(0, 100).map((row, rIdx) => (
                        <tr key={rIdx}>
                          {columns.map((col) => (
                            <td
                              key={col}
                              style={{
                                padding: '8px 14px',
                                borderBottom: '1px solid var(--border, #e2e8f0)',
                                whiteSpace: 'nowrap',
                              }}
                            >
                              {row[col] != null ? String(row[col]) : ''}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {data.length > 100 && (
                    <div style={{ padding: 12, textAlign: 'center', fontSize: 13, opacity: 0.6 }}>
                      Showing 100 of {formatNumber(data.length)} rows
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ---------- Heat Map Tab ---------- */}
            {activeTab === 'heatmap' && (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: 16 }}>Geographic Distribution</h3>
                {heatMapData.length === 0 ? (
                  <p style={{ opacity: 0.6 }}>
                    No city or location column detected in the data.
                  </p>
                ) : (
                  <div
                    style={{
                      borderRadius: 12,
                      border: '1px solid var(--border, #e2e8f0)',
                      overflow: 'auto',
                      maxHeight: 600,
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead>
                        <tr>
                          <th
                            style={{
                              position: 'sticky',
                              top: 0,
                              padding: '10px 14px',
                              textAlign: 'left',
                              background: 'var(--surface-alt, #f8fafc)',
                              borderBottom: '2px solid var(--border, #e2e8f0)',
                              fontWeight: 600,
                            }}
                          >
                            Location
                          </th>
                          <th
                            style={{
                              position: 'sticky',
                              top: 0,
                              padding: '10px 14px',
                              textAlign: 'right',
                              background: 'var(--surface-alt, #f8fafc)',
                              borderBottom: '2px solid var(--border, #e2e8f0)',
                              fontWeight: 600,
                            }}
                          >
                            Count
                          </th>
                          <th
                            style={{
                              position: 'sticky',
                              top: 0,
                              padding: '10px 14px',
                              textAlign: 'right',
                              background: 'var(--surface-alt, #f8fafc)',
                              borderBottom: '2px solid var(--border, #e2e8f0)',
                              fontWeight: 600,
                            }}
                          >
                            % of Total
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {heatMapData.map((entry) => (
                          <tr
                            key={entry.city}
                            style={{
                              background: `rgba(99, 102, 241, ${(entry.intensity * 0.25).toFixed(2)})`,
                            }}
                          >
                            <td
                              style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid var(--border, #e2e8f0)',
                                fontWeight: 500,
                              }}
                            >
                              {entry.city}
                            </td>
                            <td
                              style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid var(--border, #e2e8f0)',
                                textAlign: 'right',
                              }}
                            >
                              {formatNumber(entry.count)}
                            </td>
                            <td
                              style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid var(--border, #e2e8f0)',
                                textAlign: 'right',
                              }}
                            >
                              {((entry.count / data.length) * 100).toFixed(1)}%
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* ---------- Top Buyers Tab ---------- */}
            {activeTab === 'topbuyers' && reportType === 'Customer Purchases' && (
              <div>
                <h3 style={{ marginTop: 0, marginBottom: 16 }}>Top 20 Buyers by Total Spend</h3>
                {topBuyers.length === 0 ? (
                  <p style={{ opacity: 0.6 }}>
                    Could not identify name and revenue columns to rank buyers.
                  </p>
                ) : (
                  <div
                    style={{
                      borderRadius: 12,
                      border: '1px solid var(--border, #e2e8f0)',
                      overflow: 'auto',
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
                      <thead>
                        <tr>
                          {['Rank', 'Name', 'Total Spent', '# Orders'].map((header) => (
                            <th
                              key={header}
                              style={{
                                position: 'sticky',
                                top: 0,
                                padding: '10px 14px',
                                textAlign: header === 'Rank' ? 'center' : header === 'Name' ? 'left' : 'right',
                                background: 'var(--surface-alt, #f8fafc)',
                                borderBottom: '2px solid var(--border, #e2e8f0)',
                                fontWeight: 600,
                              }}
                            >
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {topBuyers.map((buyer, idx) => (
                          <tr key={buyer.name}>
                            <td
                              style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid var(--border, #e2e8f0)',
                                textAlign: 'center',
                                fontWeight: 700,
                                color: idx < 3 ? 'var(--primary, #6366f1)' : 'inherit',
                              }}
                            >
                              {idx + 1}
                            </td>
                            <td
                              style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid var(--border, #e2e8f0)',
                                fontWeight: 500,
                              }}
                            >
                              {buyer.name}
                            </td>
                            <td
                              style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid var(--border, #e2e8f0)',
                                textAlign: 'right',
                              }}
                            >
                              {formatCurrency(buyer.totalSpent)}
                            </td>
                            <td
                              style={{
                                padding: '10px 14px',
                                borderBottom: '1px solid var(--border, #e2e8f0)',
                                textAlign: 'right',
                              }}
                            >
                              {formatNumber(buyer.orders)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
