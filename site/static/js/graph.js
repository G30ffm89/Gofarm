$(document).ready(function() {
    const chartsContainer = $('#daily-charts-container');

    function getGlobalMin(data, key) {
        let min = Infinity;
        data.forEach(day => {
            day[key].forEach(value => {
                if (value < min) min = value;
            });
        });
        return Math.floor(min - 2); 
    }

    fetch('/api/climate_history')
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }
            return response.json();
        })
        .then(dailyData => {
            if (!dailyData || dailyData.length === 0) {
                chartsContainer.html('<p>No climate history data available.</p>');
                return;
            }

            const minTemperature = getGlobalMin(dailyData, 'temperatures');

            chartsContainer.empty();

            let tableHtml = '<table class="climate-table">';
            tableHtml += '<thead><tr><th>Metric</th>';
            dailyData.forEach(day => {
                const displayDate = new Date(day.date + 'T00:00:00').toLocaleDateString(undefined, {
                    weekday: 'short', month: 'short', day: 'numeric'
                });
                tableHtml += `<th>${displayDate}</th>`;
            });
            tableHtml += '</tr></thead>';
            tableHtml += '<tbody>';
            tableHtml += '<tr><td>Temperature</td>';
            dailyData.forEach(day => {
                const tempValues = day.temperatures.join(',');
                tableHtml += `<td><span class="peity-bar-temp">${tempValues}</span></td>`;
            });
            tableHtml += '</tr>';
            tableHtml += '<tr><td>Humidity</td>';
            dailyData.forEach(day => {
                const humidityValues = day.humidities.join(',');
                tableHtml += `<td><span class="peity-bar-humidity">${humidityValues}</span></td>`;
            });
            tableHtml += '</tr>';
            tableHtml += '</tbody></table>';

            chartsContainer.html(tableHtml);

            setTimeout(function() {
                $(".peity-bar-temp").peity("bar", {
                    fill: ["rgb(0, 123, 255)"],
                    width: '100%',
                    height: 40,
                    padding: 0.2,
                    min: minTemperature 
                });

                $(".peity-bar-humidity").peity("bar", {
                    fill: ["rgb(23, 162, 184)"],
                    width: '100%',
                    height: 40,
                    padding: 0.2
                });
            }, 0);

        })
        .catch(error => {
            console.error('Error fetching sensor data:', error);
            chartsContainer.html('<p style="color: red;"><strong>Error:</strong> Could not load climate data.</p>');
        });
});