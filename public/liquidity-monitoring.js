document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Chart.js
  await waitForChart();
  
  // Get DOM elements
  const liquidityChartCtx = document.getElementById('liquidityChart').getContext('2d');
  const symbolSelect = document.getElementById('symbolSelect');
  const outlierThreshold = document.getElementById('outlierThreshold');
  const liquidityTableBody = document.querySelector('#liquidityTable tbody');
  const refreshBtn = document.getElementById('refreshBtn');
  
  // Initialize chart variable
  let liquidityChart = null;
  let rawData = null; // Store original data for threshold filtering
  
  // Fetch available symbols
  const loadSymbols = async () => {
    try {
      const response = await fetch('/liquidity-data/symbols');
      const symbols = await response.json();
      console.log('[frontend] Available symbols:', symbols);
      
      symbolSelect.innerHTML = '<option value="">All Symbols</option>';
      symbols.forEach(symbol => {
        const option = document.createElement('option');
        option.value = symbol;
        option.textContent = symbol.toUpperCase();
        symbolSelect.appendChild(option);
      });
    } catch (error) {
      console.error('Error loading symbols:', error);
    }
  };
  
  // Fetch liquidity data based on selected symbol
  const fetchData = async (symbol = null) => {
    try {
      const params = new URLSearchParams({ limit: 100 });
      if (symbol) params.append('symbol', symbol);
      
      const response = await fetch(`/liquidity-data?${params}`);
      const data = await response.json();
      console.log('[frontend] Fetched data:', data);
      
      // Sort data by timestamp to ensure proper ordering
      data.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
      
      // Filter out data points with zero or negative liquidity
      const filteredData = data.filter(item => {
        const liquidity = parseFloat(item.liquidity);
        return !isNaN(liquidity) && liquidity > 0;
      });
      
      return filteredData;
    } catch (error) {
      console.error('Error fetching liquidity data:', error);
      return [];
    }
  };
  
  // Format timestamp for display
  const formatTimestamp = (timestamp) => {
    return new Date(timestamp).toLocaleString();
  };
  
  // Render liquidity table
  const renderTable = (data) => {
    liquidityTableBody.innerHTML = '';
    
    // Show the most recent 50 records in the table
    const displayData = data.slice(-50);
    
    displayData.forEach(item => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${item.symbol.toUpperCase()}</td>
        <td>${parseFloat(item.price).toFixed(4)}</td>
        <td>${new Intl.NumberFormat('en-US', { 
          notation: 'compact', 
          compactDisplay: 'short',
          minimumFractionDigits: 0,
          maximumFractionDigits: 2
        }).format(parseFloat(item.liquidity))}</td>
        <td>${formatTimestamp(item.timestamp)}</td>
      `;
      liquidityTableBody.appendChild(row);
    });
  };
  
  // Render liquidity chart
  const renderChart = (data) => {
    console.log('[frontend] Rendering chart with data:', data);
    if (!data || data.length === 0) {
      console.log('[frontend] No data to render, destroying existing chart');
      if (liquidityChart) {
        liquidityChart.destroy();
        liquidityChart = null;
      }
      return;
    }
    
    // Calculate outlier threshold for liquidity (upper limit)
    // Use the full raw data for threshold calculation to ensure consistency
    let upperThreshold;
    const userThreshold = outlierThreshold.value ? parseFloat(outlierThreshold.value) : null;
    
    if (userThreshold !== null && !isNaN(userThreshold)) {
      upperThreshold = userThreshold;
      console.log('[frontend] Using user-defined liquidity threshold:', upperThreshold);
    } else {
      // Use the full raw data for threshold calculation to be consistent
      const liquidityValues = rawData ? rawData.map(item => parseFloat(item.liquidity)).filter(val => !isNaN(val)) : 
                                  data.map(item => parseFloat(item.liquidity)).filter(val => !isNaN(val));
      if (liquidityValues.length === 0) {
        console.log('[frontend] No valid liquidity values to render');
        if (liquidityChart) {
          liquidityChart.destroy();
          liquidityChart = null;
        }
        return;
      }
      
      // Calculate median and IQR for outlier detection
      liquidityValues.sort((a, b) => a - b);
      const q1 = liquidityValues[Math.floor(liquidityValues.length * 0.25)];
      const q3 = liquidityValues[Math.floor(liquidityValues.length * 0.75)];
      const iqr = q3 - q1;
      upperThreshold = q3 + 2 * iqr;
      
      console.log('[frontend] Auto-calculated outlier detection: Q1:', q1, 'Q3:', q3, 'IQR:', iqr, 'Upper threshold:', upperThreshold);
    }
    
    // Group data by symbol for multiple datasets
    const symbols = [...new Set(data.map(item => item.symbol))];
    console.log('[frontend] Unique symbols:', symbols);
    
    // Create datasets for price (line) and liquidity (bar)
    const datasets = [];
    
    symbols.forEach(symbol => {
      const symbolData = data.filter(item => item.symbol === symbol);
      
      // Price line dataset
      datasets.push({
        label: `${symbol.toUpperCase()} Price`,
        data: symbolData.map(item => ({
          x: new Date(item.timestamp),
          y: item.price
        })),
        borderColor: getRandomColor(),
        backgroundColor: 'rgba(0, 0, 0, 0)',
        tension: 0.25,
        pointRadius: 2,
        spanGaps: true,
        yAxisID: 'y'
      });
      
      // Liquidity bar dataset - filter out outliers above the threshold
      const filteredLiquidityData = symbolData.filter(item => {
        const liquidity = parseFloat(item.liquidity);
        return !isNaN(liquidity) && liquidity <= upperThreshold;
      });
      
      datasets.push({
        label: `${symbol.toUpperCase()} Liquidity`,
        data: filteredLiquidityData.map(item => ({
          x: new Date(item.timestamp),
          y: item.liquidity
        })),
        borderColor: '#39FF14', // Fluorescent green
        backgroundColor: 'rgba(57, 255, 20, 0.5)', // Fluorescent green with some transparency
        type: 'bar',
        yAxisID: 'y1',
        barPercentage: 1.0, // Increased from 0.8 for wider bars
        categoryPercentage: 1.0 // Increased from 0.9 for wider bars
      });
    });
    
    // Destroy existing chart if it exists
    if (liquidityChart) {
      liquidityChart.destroy();
    }
    
    // Create new chart with dual axes
    liquidityChart = new Chart(liquidityChartCtx, {
      type: 'line',
      data: { datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false
        },
        scales: {
          x: {
            type: 'time',
            time: {
              tooltipFormat: 'PPpp',
              displayFormats: {
                minute: 'MMM d HH:mm',
                hour: 'MMM d HH:mm',
                day: 'MMM d'
              }
            },
            title: {
              display: true,
              text: 'Time'
            }
          },
          y: {
            position: 'left',
            title: {
              display: true,
              text: 'Price (USDT)'
            }
          },
          y1: {
            position: 'right',
            title: {
              display: true,
              text: 'Liquidity (USDT per 2-min)'
            },
            grid: {
              drawOnChartArea: false, // only want the grid lines for one axis to show up
            }
          }
        },
        plugins: {
          legend: {
            position: 'top',
          },
          tooltip: {
            mode: 'index',
            intersect: false,
            callbacks: {
              label: function(context) {
                let label = context.dataset.label || '';
                if (label) {
                  label += ': ';
                }
                if (context.parsed.y !== null) {
                  // Format differently based on whether it's price or liquidity
                  if (context.dataset.label.includes('Price')) {
                    label += new Intl.NumberFormat('en-US', { 
                      minimumFractionDigits: 2, 
                      maximumFractionDigits: 6 
                    }).format(context.parsed.y);
                  } else {
                    label += new Intl.NumberFormat('en-US', { 
                      notation: 'compact', 
                      compactDisplay: 'short',
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 2
                    }).format(context.parsed.y);
                  }
                }
                return label;
              }
            }
          },
          zoom: {
            zoom: {
              wheel: {
                enabled: true,
              },
              pinch: {
                enabled: true
              },
              mode: 'x',
            },
            pan: {
              enabled: true,
              mode: 'x',
            }
          }
        }
      }
    });
  };
  
  // Function to generate random colors for chart lines
  const getRandomColor = () => {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  };
  
  // Load initial data
  const loadData = async (symbol = null) => {
    console.log('[frontend] Loading data for symbol:', symbol);
    const data = await fetchData(symbol);
    console.log('[frontend] Rendering chart with data length:', data.length);
    
    // Store raw data for later filtering
    rawData = data;
    
    // Limit to last 20 data points for better visualization
    const limitedData = data.slice(-20);
    renderChart(limitedData);
    console.log('[frontend] Rendering table with data length:', data.length);
    renderTable(data);
  };
  
  // Event listeners
  symbolSelect.addEventListener('change', () => {
    loadData(symbolSelect.value);
  });
  
  refreshBtn.addEventListener('click', async () => {
    await loadData(symbolSelect.value);
    // After loading new data, keep the current threshold in the input if it was manually set
  });
  
  // Add event listener for outlier threshold input
  outlierThreshold.addEventListener('input', () => {
    if (rawData) {
      // Re-render the chart with the new threshold without fetching new data
      // Limit to last 20 data points for better visualization
      const limitedData = rawData.slice(-20);
      renderChart(limitedData);
    } else {
      // If no raw data available, fetch it again
      loadData(symbolSelect.value);
    }
  });
  
  // Initial load
  await loadSymbols();
  await loadData();
});