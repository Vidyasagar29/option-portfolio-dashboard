const APP_CONFIG = window.APP_CONFIG || {};
const DATA_SOURCE = APP_CONFIG.dataSource || "csv";
const CSV_URL = APP_CONFIG.csvUrl || "./nifty_close.csv";
const SUPABASE_CONFIG = APP_CONFIG.supabase || {};

// Portfolio Parameters
const PORTFOLIO = {
    quantity: 2475,
    putStrike: 26000,
    callStrike: 29000,
    putIV: 0.16,
    callIV: 0.09,
    riskFreeRate: 0.10,
    expiryDate: new Date("2026-12-29")
};

let portfolioData = null;

async function fetchPriceData() {
    if (DATA_SOURCE === "supabase") {
        return fetchPriceDataFromSupabase();
    }

    return fetchPriceDataFromCsv();
}

async function fetchPriceDataFromCsv() {
    const response = await fetch(CSV_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const csvText = await response.text();
    const priceData = parseCSV(csvText);

    if (priceData.length === 0) throw new Error("No valid data");

    return priceData;
}

async function fetchPriceDataFromSupabase() {
    const { url, anonKey, table, dateColumn, closeColumn } = SUPABASE_CONFIG;

    if (!url || !anonKey || !table || !dateColumn || !closeColumn) {
        throw new Error("Supabase config is incomplete");
    }

    const query = `${dateColumn},${closeColumn}`;
    const requestUrl = `${url}/rest/v1/${table}?select=${encodeURIComponent(query)}&order=${dateColumn}.asc`;
    const response = await fetch(requestUrl, {
        headers: {
            apikey: anonKey,
            Authorization: `Bearer ${anonKey}`
        }
    });

    if (!response.ok) {
        throw new Error(`Supabase ${response.status}`);
    }

    const rows = await response.json();
    const priceData = rows
        .map((row) => {
            const date = new Date(row[dateColumn]);
            const close = parseFloat(row[closeColumn]);

            if (isNaN(date.getTime()) || isNaN(close)) {
                return null;
            }

            return { date, close };
        })
        .filter(Boolean);

    if (priceData.length === 0) throw new Error("No valid data");

    return priceData;
}

function switchTab(tabName, button) {
    document.querySelectorAll(".tab-btn").forEach((btn) => btn.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((content) => content.classList.remove("active"));

    if (button) {
        button.classList.add("active");
    }
    document.getElementById("tab" + tabName.charAt(0).toUpperCase() + tabName.slice(1)).classList.add("active");

    if (tabName === "chart" && portfolioData) {
        setTimeout(() => updateChart(portfolioData.dailyData), 50);
    }
}

function switchMobileTab(tabName, button) {
    document.querySelectorAll(".mobile-tab-btn").forEach((btn) => btn.classList.remove("active"));
    if (button) {
        button.classList.add("active");
    }

    const leftPanel = document.querySelector(".left-panel");
    const rightPanel = document.querySelector(".right-panel");
    const tabChart = document.getElementById("tabChart");
    const tabPayoff = document.getElementById("tabPayoff");

    leftPanel.style.display = "none";
    rightPanel.style.display = "grid";
    tabChart.classList.remove("active");
    tabPayoff.classList.remove("active");

    if (tabName === "snapshot") {
        leftPanel.style.display = "block";
        rightPanel.style.display = "none";
    } else if (tabName === "chart") {
        tabChart.classList.add("active");
        if (portfolioData) {
            setTimeout(() => updateChart(portfolioData.dailyData), 50);
        }
    } else if (tabName === "payoff") {
        tabPayoff.classList.add("active");
    }
}

function formatINR(value) {
    return "\u20B9" + value.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function formatNumber(value) {
    return value.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
}

function cumulativeNormalDistribution(x) {
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const prob = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - prob : prob;
}

function blackScholes(spot, strike, timeToExpiry, riskFreeRate, volatility, optionType) {
    if (timeToExpiry <= 0) {
        if (optionType === "call") {
            return Math.max(spot - strike, 0);
        }

        return Math.max(strike - spot, 0);
    }

    const d1 = (Math.log(spot / strike) + (riskFreeRate + 0.5 * volatility * volatility) * timeToExpiry) /
        (volatility * Math.sqrt(timeToExpiry));
    const d2 = d1 - volatility * Math.sqrt(timeToExpiry);

    if (optionType === "call") {
        return spot * cumulativeNormalDistribution(d1) -
            strike * Math.exp(-riskFreeRate * timeToExpiry) * cumulativeNormalDistribution(d2);
    }

    return strike * Math.exp(-riskFreeRate * timeToExpiry) * cumulativeNormalDistribution(-d2) -
        spot * cumulativeNormalDistribution(-d1);
}

function parseCSV(text) {
    const lines = text.trim().split("\n");
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const [dateStr, closeStr] = line.split(",");
        const date = new Date(dateStr.trim());
        const close = parseFloat(closeStr.trim());

        if (!isNaN(date.getTime()) && !isNaN(close)) {
            data.push({ date, close });
        }
    }

    data.sort((a, b) => a.date - b.date);
    return data;
}

function calculatePortfolio(priceData) {
    if (priceData.length === 0) return null;

    const startDate = priceData[0].date;
    const startSpot = priceData[0].close;

    const startTimeToExpiry = (PORTFOLIO.expiryDate - startDate) / (1000 * 60 * 60 * 24 * 365);

    const startPutPrice = blackScholes(
        startSpot,
        PORTFOLIO.putStrike,
        startTimeToExpiry,
        PORTFOLIO.riskFreeRate,
        PORTFOLIO.putIV,
        "put"
    );

    const startCallPrice = blackScholes(
        startSpot,
        PORTFOLIO.callStrike,
        startTimeToExpiry,
        PORTFOLIO.riskFreeRate,
        PORTFOLIO.callIV,
        "call"
    );

    const dailyData = priceData.map((entry) => {
        const timeToExpiry = Math.max(0, (PORTFOLIO.expiryDate - entry.date) / (1000 * 60 * 60 * 24 * 365));

        const putPrice = blackScholes(
            entry.close,
            PORTFOLIO.putStrike,
            timeToExpiry,
            PORTFOLIO.riskFreeRate,
            PORTFOLIO.putIV,
            "put"
        );

        const callPrice = blackScholes(
            entry.close,
            PORTFOLIO.callStrike,
            timeToExpiry,
            PORTFOLIO.riskFreeRate,
            PORTFOLIO.callIV,
            "call"
        );

        const spotPL = (entry.close - startSpot) * PORTFOLIO.quantity;
        const putPL = (putPrice - startPutPrice) * PORTFOLIO.quantity;
        const callPL = (startCallPrice - callPrice) * PORTFOLIO.quantity;
        const totalPL = spotPL + putPL + callPL;

        return {
            date: entry.date,
            spot: entry.close,
            putPrice,
            callPrice,
            totalPL
        };
    });

    const latestData = dailyData[dailyData.length - 1];

    return {
        startSpot,
        startPutPrice,
        startCallPrice,
        latest: latestData,
        dailyData
    };
}

function formatINRFull(value) {
    const isNegative = value < 0;
    const absValue = Math.abs(value);

    const formatted = absValue.toLocaleString("en-IN", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });

    return (isNegative ? "-\u20B9" : "\u20B9") + formatted;
}

function updateSnapshotTable(portfolio) {
    const container = document.getElementById("snapshotCards");
    const profitLine = document.getElementById("totalProfit");

    const spotPL = (portfolio.latest.spot - portfolio.startSpot) * PORTFOLIO.quantity;
    const putPL = (portfolio.latest.putPrice - portfolio.startPutPrice) * PORTFOLIO.quantity;
    const callPL = (portfolio.startCallPrice - portfolio.latest.callPrice) * PORTFOLIO.quantity;
    const totalPL = portfolio.latest.totalPL;

    if (profitLine) {
        profitLine.className = `profit-line ${totalPL >= 0 ? "positive" : "negative"}`;
        profitLine.innerHTML = `
            <span class="profit-line-label">Total Portfolio P&amp;L</span>
            <span class="profit-line-value">${formatINRFull(totalPL)}</span>
        `;
    }

    container.innerHTML = `
        <div class="portfolio-card position-card ${spotPL >= 0 ? "positive-card" : "negative-card"}">
            <div class="card-title-row">
                <div class="card-symbol">NIFTY Long Futures</div>
                <div class="card-pnl-big ${spotPL >= 0 ? "positive" : "negative"}">
                    ${formatINRFull(spotPL)}
                </div>
            </div>
            <div class="card-details">
                <div class="card-detail-row">
                    <span class="label">Quantity:</span>
                    <span class="value">${PORTFOLIO.quantity.toLocaleString()}</span>
                </div>
                <div class="card-detail-row">
                    <span class="label">Buy Price:</span>
                    <span class="value">${formatNumber(portfolio.startSpot)}</span>
                </div>
                <div class="card-detail-row">
                    <span class="label">Current Price:</span>
                    <span class="value">${formatNumber(portfolio.latest.spot)}</span>
                </div>
            </div>
        </div>

        <div class="portfolio-card position-card ${putPL >= 0 ? "positive-card" : "negative-card"}">
            <div class="card-title-row">
                <div class="card-symbol">Long PUT 26000</div>
                <div class="card-pnl-big ${putPL >= 0 ? "positive" : "negative"}">
                    ${formatINRFull(putPL)}
                </div>
            </div>
            <div class="card-details">
                <div class="card-detail-row">
                    <span class="label">Quantity:</span>
                    <span class="value">${PORTFOLIO.quantity.toLocaleString()}</span>
                </div>
                <div class="card-detail-row">
                    <span class="label">Buy Price:</span>
                    <span class="value">${formatNumber(portfolio.startPutPrice)}</span>
                </div>
                <div class="card-detail-row">
                    <span class="label">Current Price:</span>
                    <span class="value">${formatNumber(portfolio.latest.putPrice)}</span>
                </div>
            </div>
        </div>

        <div class="portfolio-card position-card ${callPL >= 0 ? "positive-card" : "negative-card"}">
            <div class="card-title-row">
                <div class="card-symbol">Short CALL 29000</div>
                <div class="card-pnl-big ${callPL >= 0 ? "positive" : "negative"}">
                    ${formatINRFull(callPL)}
                </div>
            </div>
            <div class="card-details">
                <div class="card-detail-row">
                    <span class="label">Quantity:</span>
                    <span class="value">${PORTFOLIO.quantity.toLocaleString()}</span>
                </div>
                <div class="card-detail-row">
                    <span class="label">Sell Price:</span>
                    <span class="value">${formatNumber(portfolio.startCallPrice)}</span>
                </div>
                <div class="card-detail-row">
                    <span class="label">Current Price:</span>
                    <span class="value">${formatNumber(portfolio.latest.callPrice)}</span>
                </div>
            </div>
        </div>
    `;
}

function updatePayoffTable(dailyData) {
    const tbody = document.querySelector("#payoffTable tbody");
    const rowCount = document.getElementById("rowCount");

    if (rowCount) {
        rowCount.textContent = `${dailyData.length} Rows`;
    }

    tbody.innerHTML = dailyData.map((row) => {
        const dateStr = row.date.toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "2-digit",
            year: "2-digit"
        });

        return `
            <tr>
                <td>${dateStr}</td>
                <td>${formatNumber(row.spot)}</td>
                <td>${formatNumber(row.putPrice)}</td>
                <td>${formatNumber(row.callPrice)}</td>
                <td class="${row.totalPL >= 0 ? "positive" : "negative"}">${formatINR(row.totalPL)}</td>
            </tr>
        `;
    }).join("");
}

function updateChart(dailyData) {
    const container = document.getElementById("chartContainer");
    if (!container) return;

    container.innerHTML = "";

    const isMobile = window.innerWidth <= 768;
    const width = container.offsetWidth || 400;
    const height = container.offsetHeight || 400;

    const margin = { top: 28, right: 76, bottom: 42, left: 86 };
    const chartWidth = width - margin.left - margin.right;
    const chartHeight = height - margin.top - margin.bottom;

    const plValues = dailyData.map((d) => d.totalPL);
    const spotValues = dailyData.map((d) => d.spot);

    const maxPL = Math.max(...plValues);
    const minPL = Math.min(...plValues);
    const maxSpot = Math.max(...spotValues);
    const minSpot = Math.min(...spotValues);

    const plRange = maxPL - minPL || 1;
    const spotRange = maxSpot - minSpot || 1;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.background = "#ffffff";

    const chartSurface = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    chartSurface.setAttribute("x", margin.left);
    chartSurface.setAttribute("y", margin.top);
    chartSurface.setAttribute("width", chartWidth);
    chartSurface.setAttribute("height", chartHeight);
    chartSurface.setAttribute("rx", "0");
    chartSurface.setAttribute("fill", "rgba(255,255,255,0.9)");
    chartSurface.setAttribute("stroke", "rgba(189, 201, 214, 0.35)");
    svg.appendChild(chartSurface);

    const xScale = (i) => margin.left + (i / (dailyData.length - 1)) * chartWidth;
    const yScalePL = (value) => margin.top + chartHeight - ((value - minPL) / plRange) * chartHeight;
    const yScaleSpot = (value) => margin.top + chartHeight - ((value - minSpot) / spotRange) * chartHeight;

    for (let i = 0; i <= 5; i++) {
        const y = margin.top + (chartHeight * i / 5);
        const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("x1", margin.left);
        line.setAttribute("y1", y);
        line.setAttribute("x2", width - margin.right);
        line.setAttribute("y2", y);
        line.setAttribute("stroke", "#dbe4ed");
        line.setAttribute("stroke-width", "1");
        svg.appendChild(line);
    }

    if (minPL < 0 && maxPL > 0) {
        const zeroY = yScalePL(0);
        const zeroLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        zeroLine.setAttribute("x1", margin.left);
        zeroLine.setAttribute("y1", zeroY);
        zeroLine.setAttribute("x2", width - margin.right);
        zeroLine.setAttribute("y2", zeroY);
        zeroLine.setAttribute("stroke", "#d5c4a4");
        zeroLine.setAttribute("stroke-width", "1.2");
        zeroLine.setAttribute("stroke-dasharray", "6,6");
        svg.appendChild(zeroLine);
    }

    const plAreaPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    let plAreaD = `M ${margin.left} ${margin.top + chartHeight} `;
    dailyData.forEach((d, i) => {
        plAreaD += `L ${xScale(i)} ${yScalePL(d.totalPL)} `;
    });
    plAreaD += `L ${xScale(dailyData.length - 1)} ${margin.top + chartHeight} Z`;
    plAreaPath.setAttribute("d", plAreaD);
    plAreaPath.setAttribute("fill", "#d0b182");
    plAreaPath.setAttribute("opacity", "0.13");
    svg.appendChild(plAreaPath);

    const plLinePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    let plLineD = "";
    dailyData.forEach((d, i) => {
        plLineD += (i === 0 ? "M " : " L ") + `${xScale(i)} ${yScalePL(d.totalPL)}`;
    });
    plLinePath.setAttribute("d", plLineD);
    plLinePath.setAttribute("fill", "none");
    plLinePath.setAttribute("stroke", "#caa25b");
    plLinePath.setAttribute("stroke-width", "3");
    svg.appendChild(plLinePath);

    const spotLinePath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    let spotLineD = "";
    dailyData.forEach((d, i) => {
        spotLineD += (i === 0 ? "M " : " L ") + `${xScale(i)} ${yScaleSpot(d.spot)}`;
    });
    spotLinePath.setAttribute("d", spotLineD);
    spotLinePath.setAttribute("fill", "none");
    spotLinePath.setAttribute("stroke", "#5c99ff");
    spotLinePath.setAttribute("stroke-width", "2.6");
    svg.appendChild(spotLinePath);

    for (let i = 0; i <= 5; i++) {
        const value = minPL + plRange * (5 - i) / 5;
        const y = margin.top + (chartHeight * i / 5);
        const label = value.toLocaleString("en-IN", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", margin.left - 12);
        text.setAttribute("y", y + 4);
        text.setAttribute("fill", "#7e96b3");
        text.setAttribute("font-size", "10");
        text.setAttribute("text-anchor", "end");
        text.textContent = label;
        svg.appendChild(text);
    }

    for (let i = 0; i <= 5; i++) {
        const value = minSpot + spotRange * (5 - i) / 5;
        const y = margin.top + (chartHeight * i / 5);

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", width - margin.right + 10);
        text.setAttribute("y", y + 4);
        text.setAttribute("fill", "#6f8db4");
        text.setAttribute("font-size", "10");
        text.textContent = Math.round(value).toLocaleString("en-IN");
        svg.appendChild(text);
    }

    const labelCount = isMobile ? 4 : 6;
    for (let i = 0; i < labelCount; i++) {
        const index = Math.floor(i * (dailyData.length - 1) / (labelCount - 1));
        const date = dailyData[index].date.toLocaleDateString("en-IN", {
            day: "2-digit",
            month: "short"
        });

        const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
        text.setAttribute("x", xScale(index));
        text.setAttribute("y", margin.top + chartHeight + 25);
        text.setAttribute("fill", "#7e96b3");
        text.setAttribute("font-size", "9.5");
        text.setAttribute("text-anchor", "middle");
        text.textContent = date;
        svg.appendChild(text);
    }

    const tooltip = document.createElement("div");
    tooltip.className = "chart-tooltip";
    container.appendChild(tooltip);

    const crosshairV = document.createElementNS("http://www.w3.org/2000/svg", "line");
    crosshairV.setAttribute("stroke", "#bccbdd");
    crosshairV.setAttribute("stroke-width", "1");
    crosshairV.setAttribute("stroke-dasharray", "6,6");
    crosshairV.setAttribute("opacity", "0.9");
    crosshairV.style.display = "none";
    svg.appendChild(crosshairV);

    const crosshairH = document.createElementNS("http://www.w3.org/2000/svg", "line");
    crosshairH.setAttribute("stroke", "#d9c9ad");
    crosshairH.setAttribute("stroke-width", "1");
    crosshairH.setAttribute("stroke-dasharray", "6,6");
    crosshairH.setAttribute("opacity", "0.9");
    crosshairH.style.display = "none";
    svg.appendChild(crosshairH);

    const hoverCirclePL = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hoverCirclePL.setAttribute("r", "4.5");
    hoverCirclePL.setAttribute("fill", "#caa25b");
    hoverCirclePL.setAttribute("stroke", "#fff");
    hoverCirclePL.setAttribute("stroke-width", "2");
    hoverCirclePL.style.display = "none";
    svg.appendChild(hoverCirclePL);

    const hoverCircleSpot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    hoverCircleSpot.setAttribute("r", "4.5");
    hoverCircleSpot.setAttribute("fill", "#5c99ff");
    hoverCircleSpot.setAttribute("stroke", "#fff");
    hoverCircleSpot.setAttribute("stroke-width", "2");
    hoverCircleSpot.style.display = "none";
    svg.appendChild(hoverCircleSpot);

    svg.addEventListener("mousemove", (e) => {
        const rect = svg.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        if (mouseX < margin.left || mouseX > width - margin.right ||
            mouseY < margin.top || mouseY > margin.top + chartHeight) {
            tooltip.style.display = "none";
            hoverCirclePL.style.display = "none";
            hoverCircleSpot.style.display = "none";
            crosshairV.style.display = "none";
            crosshairH.style.display = "none";
            return;
        }

        const relativeX = mouseX - margin.left;
        const index = Math.round((relativeX / chartWidth) * (dailyData.length - 1));

        if (index >= 0 && index < dailyData.length) {
            const data = dailyData[index];
            const pointX = xScale(index);
            const pointYPL = yScalePL(data.totalPL);

            const date = data.date.toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric"
            });

            tooltip.innerHTML = `
                <div style="font-weight: 700; color: #1f2c3a; margin-bottom: 6px;">${date}</div>
                <div style="color: #33485f;">Spot: ${formatNumber(data.spot)}</div>
                <div>Put: ${formatNumber(data.putPrice)}</div>
                <div>Call: ${formatNumber(data.callPrice)}</div>
                <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #e6d8c2; font-weight: 700; color: ${data.totalPL >= 0 ? "#178a57" : "#c14444"};">
                    P&L: ${data.totalPL < 0 ? "-Rs " : "Rs "}${Math.abs(data.totalPL).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </div>
            `;

            tooltip.style.display = "block";

            const tooltipWidth = 220;
            const tooltipHeight = 150;
            const offset = 8;

            let tooltipX = e.clientX + offset;
            let tooltipY = e.clientY + offset;

            if (tooltipX + tooltipWidth > window.innerWidth) {
                tooltipX = e.clientX - tooltipWidth - offset;
            }
            if (tooltipY + tooltipHeight > window.innerHeight) {
                tooltipY = e.clientY - tooltipHeight - offset;
            }

            tooltipX = Math.max(5, Math.min(tooltipX, window.innerWidth - tooltipWidth - 5));
            tooltipY = Math.max(5, Math.min(tooltipY, window.innerHeight - tooltipHeight - 5));

            tooltip.style.left = tooltipX + "px";
            tooltip.style.top = tooltipY + "px";

            crosshairV.setAttribute("x1", pointX);
            crosshairV.setAttribute("y1", margin.top);
            crosshairV.setAttribute("x2", pointX);
            crosshairV.setAttribute("y2", margin.top + chartHeight);
            crosshairV.style.display = "block";

            crosshairH.setAttribute("x1", margin.left);
            crosshairH.setAttribute("y1", pointYPL);
            crosshairH.setAttribute("x2", width - margin.right);
            crosshairH.setAttribute("y2", pointYPL);
            crosshairH.style.display = "block";

            hoverCirclePL.setAttribute("cx", pointX);
            hoverCirclePL.setAttribute("cy", pointYPL);
            hoverCirclePL.style.display = "block";

            hoverCircleSpot.setAttribute("cx", pointX);
            hoverCircleSpot.setAttribute("cy", yScaleSpot(data.spot));
            hoverCircleSpot.style.display = "block";
        }
    });

    svg.addEventListener("mouseleave", () => {
        tooltip.style.display = "none";
        hoverCirclePL.style.display = "none";
        hoverCircleSpot.style.display = "none";
        crosshairV.style.display = "none";
        crosshairH.style.display = "none";
    });

    container.appendChild(svg);
}

async function loadData() {
    const statusIndicator = document.getElementById("statusIndicator");
    statusIndicator.className = "status loading";
    statusIndicator.textContent = `Fetching ${DATA_SOURCE} data...`;

    try {
        const priceData = await fetchPriceData();

        portfolioData = calculatePortfolio(priceData);

        updateSnapshotTable(portfolioData);
        updatePayoffTable(portfolioData.dailyData);

        setTimeout(() => updateChart(portfolioData.dailyData), 100);

        const lastDate = priceData[priceData.length - 1].date.toLocaleDateString("en-IN");
        statusIndicator.className = "status success";
        statusIndicator.textContent = `Updated: ${lastDate}`;
    } catch (error) {
        statusIndicator.className = "status error";
        statusIndicator.textContent = `Error: ${error.message}`;
    }
}

function syncResponsivePanels() {
    const leftPanel = document.querySelector(".left-panel");
    const rightPanel = document.querySelector(".right-panel");
    if (!leftPanel || !rightPanel) return;

    if (window.innerWidth > 768) {
        leftPanel.style.display = "";
        rightPanel.style.display = "";
    } else {
        leftPanel.style.display = "block";
        rightPanel.style.display = "none";
    }
}

document.addEventListener("DOMContentLoaded", loadData);
document.addEventListener("DOMContentLoaded", syncResponsivePanels);

let resizeTimeout;
window.addEventListener("resize", () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(() => {
        syncResponsivePanels();
        if (portfolioData) updateChart(portfolioData.dailyData);
    }, 250);
});
