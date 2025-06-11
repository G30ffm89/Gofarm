 $(document).ready(function() {
            const chartsContainer = $('#daily-charts-container');

            fetch('/api/climate_history')
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`HTTP error! Status: ${response.status}`);
                    }
                    return response.json();
                })
                .then(dailyData => {
  
                    chartsContainer.empty();

                    if (!dailyData || dailyData.length === 0) {
                        chartsContainer.html('<p>No climate history data available for the last 7 days.</p>');
                        return;
                    }

                    dailyData.forEach(day => {
                        const tempValues = day.temperatures.join(',');
                        const humidityValues = day.humidities.join(',');
                        
                     
                        const displayDate = new Date(day.date + 'T00:00:00').toLocaleDateString(undefined, {
                            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
                        });

                        const dayHtml = `
                            <div class="day-chart-group">
                                <h3>${displayDate}</h3>
                                <div class="charts-row">
                                    <span class="chart-label">Temperature:</span>
                                    <span class="peity-line-temp">${tempValues}</span>
                                    
                                    <span class="chart-label">Humidity:</span>
                                    <span class="peity-line-humidity">${humidityValues}</span>
                                </div>
                            </div>
                        `;

                        chartsContainer.append(dayHtml);
                    });

       
                    $(".peity-line-temp").peity("line", {
                        fill: "rgba(0, 123, 255, 0.1)",
                        stroke: "rgb(0, 123, 255)",
                        width: 100, 
                        height: 32  
                    });
                    $(".peity-line-humidity").peity("line", {
                        fill: "rgba(23, 162, 184, 0.1)",
                        stroke: "rgb(23, 162, 184)",
                        width: 100, 
                        height: 32  
                    });
                })
                .catch(error => {
                    console.error('Error fetching sensor data:', error);
                    chartsContainer.html('<p style="color: red;"><strong>Error:</strong> Could not load climate data. Please check the server console.</p>');
                });
        });