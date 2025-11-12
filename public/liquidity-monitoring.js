/* eslint-disable no-unused-vars, no-undef */
document.addEventListener('DOMContentLoaded', async () => {
  // Initialize Chart.js
  await waitForChart();
  
  // Get DOM elements
  const liquidityChartCtx = document.getElementById('liquidityChart').getContext('2d');
  const symbolSelect = document.getElementById('symbolSelect');
  const outlierThreshold = document.getElementById('outlierThreshold');
  const liquidityTableBody = document.querySelector('#liquidityTable tbody');
  const refreshBtn = document.getElementById('refreshBtn');
  
  // Add Load More button to the DOM
  const chartNav = document.querySelector('.chart-nav');
  const loadMoreBtn = document.createElement('button');
  loadMoreBtn.id = 'loadMoreBtn';
  loadMoreBtn.className = 'btn';
  loadMoreBtn.textContent = 'Load More';
  loadMoreBtn.title = 'Load previous day data';
  chartNav.appendChild(loadMoreBtn);
  
  // Initialize pagination controls in the table section
  const tableSection = document.querySelector('section.card:last-of-type');
  const tableControlsDiv = document.createElement('div');
  tableControlsDiv.className = 'table-controls';
  tableControlsDiv.innerHTML = `
    <div class="pagination-controls">
      <span>Show:</span>
      <select id="paginationLimit">
        <option value="50">50</option>
        <option value="100" selected>100</option>
        <option value="500">500</option>
        <option value="1000">1000</option>
      </select>
      <span>entries per page</span>
    </div>
    <div id="paginationInfo"></div>
    <div class="pagination-nav">
      <button id="prevPageBtn" class="btn" disabled>Previous</button>
      <span id="currentPageInfo">Page 1</span>
      <button id="nextPageBtn" class="btn">Next</button>
    </div>
  `;
  tableSection.insertBefore(tableControlsDiv, tableSection.firstChild);
  
  // Pagination state variables
  const paginationLimitSelect = document.getElementById('paginationLimit');
  const paginationInfo = document.getElementById('paginationInfo');
  const prevPageBtn = document.getElementById('prevPageBtn');
  const nextPageBtn = document.getElementById('nextPageBtn');
  const currentPageInfo = document.getElementById('currentPageInfo');
  
  let currentPage = 1;
  let currentDisplayData = [];
  
  // Initialize chart variable
  let liquidityChart = null;
  let rawData = null; // Store original data for threshold filtering
  let previousTimeWindows = []; // Track loaded time windows to avoid duplicates
  let isLoadingMore = false; // Prevent multiple simultaneous requests
  
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
  
  // Fetch liquidity data based on selected symbol and time window
  const fetchData = async (symbol = null, startTime = null, endTime = null) => {
    try {
      const params = new URLSearchParams();
      
      // Set default parameters if not provided
      if (!startTime && !endTime) {
        // Default: last 1 day
        const now = new Date();
        const oneDayAgo = new Date();
        oneDayAgo.setDate(now.getDate() - 1);
        
        params.append('startTime', oneDayAgo.toISOString());
        params.append('endTime', now.toISOString());
      } else {
        if (startTime) params.append('startTime', startTime.toISOString());
        if (endTime) params.append('endTime', endTime.toISOString());
      }
      
      // Add limit and symbol parameters
      params.append('limit', 1000); // Increased limit for better time-series view
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
  
  // Calculate pagination data based on current page and limit
  const calculatePaginationData = () => {
    const limit = parseInt(paginationLimitSelect.value);
    const startIndex = (currentPage - 1) * limit;
    const endIndex = startIndex + limit;
    
    return {
      pageData: currentDisplayData.slice(startIndex, endIndex),
      startIndex: startIndex,
      endIndex: endIndex,
      totalPages: Math.ceil(currentDisplayData.length / limit)
    };
  };
  
  // Render pagination controls
  const renderPaginationControls = () => {
    const totalPages = Math.ceil(currentDisplayData.length / parseInt(paginationLimitSelect.value));
    
    // Update current page information
    currentPageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    
    // Update pagination info
    const currentStart = (currentPage - 1) * parseInt(paginationLimitSelect.value) + 1;
    const currentEnd = Math.min(currentPage * parseInt(paginationLimitSelect.value), currentDisplayData.length);
    paginationInfo.textContent = `Showing ${currentStart} to ${currentEnd} of ${currentDisplayData.length} entries`;
    
    // Enable/disable navigation buttons
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages || totalPages === 0;
  };
  
  // Render liquidity table with pagination
  const renderTable = (data) => {
    // Update the current display data
    currentDisplayData = data;
    totalDisplayData = data.length;
    
    // Reset to first page when data changes
    currentPage = 1;
    
    // Calculate the data to show based on current page and limit
    const { pageData } = calculatePaginationData();
    
    // Clear the table body
    liquidityTableBody.innerHTML = '';
    
    // Add data to the table
    pageData.forEach(item => {
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
    
    // Render pagination controls
    renderPaginationControls();
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
  
  // Load initial data with default 1-day window
  const loadData = async (symbol = null) => {
    console.log('[frontend] Loading data for symbol:', symbol);
    
    // Default: last 1 day for initial load
    const now = new Date();
    const oneDayAgo = new Date();
    oneDayAgo.setDate(now.getDate() - 1);
    
    const data = await fetchData(symbol, oneDayAgo, now);
    console.log('[frontend] Rendering chart with data length:', data.length);
    
    // Store raw data for later filtering
    rawData = data;
    
    renderChart(data);
    console.log('[frontend] Rendering table with data length:', data.length);
    renderTable(data);
  };
  
  // Load more data for previous day
  const loadMoreData = async () => {
    if (isLoadingMore) return; // Prevent multiple requests
    
    isLoadingMore = true;
    loadMoreBtn.disabled = true;
    loadMoreBtn.textContent = 'Loading...';
    
    try {
      // Calculate the time window for the previous day based on the earliest timestamp in current data
      let previousEndTime;
      if (rawData && rawData.length > 0) {
        // Use the earliest timestamp in current data as the end time for the previous period
        const sortedData = [...rawData].sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        previousEndTime = new Date(sortedData[0].timestamp);
      } else {
        // Fallback: use current time if no data is loaded yet
        previousEndTime = new Date();
      }
      
      // Calculate start time as 1 day before the end time
      const previousStartTime = new Date(previousEndTime);
      previousStartTime.setDate(previousStartTime.getDate() - 1);
      
      console.log('[frontend] Loading more data from:', previousStartTime.toISOString(), 'to:', previousEndTime.toISOString());
      
      const additionalData = await fetchData(symbolSelect.value, previousStartTime, previousEndTime);
      console.log('[frontend] Loaded additional data points:', additionalData.length);
      
      if (additionalData.length > 0) {
        // Combine with existing data
        rawData = [...additionalData, ...rawData];
        
        // Re-render the chart with all data
        renderChart(rawData);
        renderTable(rawData); // This will also update the table with new data
      }
    } catch (error) {
      console.error('Error loading more data:', error);
    } finally {
      isLoadingMore = false;
      loadMoreBtn.disabled = false;
      loadMoreBtn.textContent = 'Load More';
    }
  };
  
  // Event listeners
  symbolSelect.addEventListener('change', () => {
    loadData(symbolSelect.value);
  });
  
  refreshBtn.addEventListener('click', async () => {
    await loadData(symbolSelect.value);
    // After loading new data, keep the current threshold in the input if it was manually set
  });
  
  loadMoreBtn.addEventListener('click', async () => {
    await loadMoreData();
  });
  
  // Add pagination event listeners
  paginationLimitSelect.addEventListener('change', () => {
    currentPage = 1; // Reset to first page when limit changes
    renderTable(currentDisplayData);
  });
  
  prevPageBtn.addEventListener('click', () => {
    if (currentPage > 1) {
      currentPage--;
      renderTable(currentDisplayData);
    }
  });
  
  nextPageBtn.addEventListener('click', () => {
    const totalPages = Math.ceil(currentDisplayData.length / parseInt(paginationLimitSelect.value));
    if (currentPage < totalPages) {
      currentPage++;
      renderTable(currentDisplayData);
    }
  });
  
  // Add event listener for outlier threshold input
  outlierThreshold.addEventListener('input', () => {
    if (rawData) {
      // Re-render the chart with the new threshold without fetching new data
      renderChart(rawData);
    } else {
      // If no raw data available, fetch it again
      loadData(symbolSelect.value);
    }
  });
  
  // Initial load
  await loadSymbols();
  await loadData();

  // Dropdown menu logic
  const navDropdownButton = document.getElementById('nav-dropdown-button');
  const navDropdown = document.getElementById('nav-dropdown');

  if (navDropdownButton && navDropdown) {
    navDropdownButton.addEventListener('click', (event) => {
      event.stopPropagation(); // Prevent document click from closing immediately
      navDropdown.classList.toggle('open');
    });

    document.addEventListener('click', (event) => {
      if (!navDropdown.contains(event.target) && !navDropdownButton.contains(event.target)) {
        navDropdown.classList.remove('open');
      }
    });
  }
});