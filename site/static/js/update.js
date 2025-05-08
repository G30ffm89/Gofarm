let humid_gauge;
let temp_guage;
let thchart;
let initialConfigLoaded = false;

// MQTT Configuration
const mqttBroker = 'ws://192.168.1.170:9001';
const mqttClientId = 'web-client-' + Math.random().toString(16).substr(2, 8);
const mqttTopicSensors = 'farm/sensors/sensors';
const mqttTopicDevices = 'farm/sensors/devices';
const mqttTopicOverride = 'farm/sensors/override';
const mqttTopicConfigSet = 'farm/sensors/config';
const mqttTopicConfigStatus = 'farm/sensors/status';

function connectMQTT() {
    client = mqtt.connect(mqttBroker, { clientId: mqttClientId });

    client.on('connect', function () {
        console.log('MQTT: Connected to', mqttBroker, 'with Client ID', mqttClientId);
        client.subscribe(mqttTopicSensors, { qos: 0 }, function (err) {
            if (err) {
                console.error('MQTT: Error subscribing to', mqttTopicSensors, err);
            } else {
                console.log('MQTT: Subscribed to', mqttTopicSensors);
            }
        });
        client.subscribe(mqttTopicDevices, { qos: 0 }, function (err) {
            if (err) {
                console.error('MQTT: Error subscribing to', mqttTopicDevices, err);
            } else {
                console.log('MQTT: Subscribed to', mqttTopicDevices);
            }
        });
        client.subscribe(mqttTopicConfigStatus, { qos: 0 }, function (err) {
            if (err) {
                console.error('MQTT: Error subscribing to', mqttTopicConfigStatus, err);
            } else {
                console.log('MQTT: Subscribed to', mqttTopicConfigStatus);
            }
        });
    });

    client.on('error', function (err) {
        console.error('MQTT: Connection error:', err);
    });

    client.on('message', function (topic, payload) {
        try {
            const data = JSON.parse(payload.toString());
            console.log('MQTT: Received message on', topic, 'with payload:', data);
    
            if (topic === mqttTopicSensors) {
                handleSensorData(data);
            } else if (topic === mqttTopicDevices) {
                handleDeviceState(data);
            } else if (topic === mqttTopicConfigStatus) {
                if (!initialConfigLoaded) {
                    updateConfigForm(data);
                    initialConfigLoaded = true;
                    client.unsubscribe(mqttTopicConfigStatus); // Unsubscribe after first message
                    console.log('MQTT: Unsubscribed from', mqttTopicConfigStatus);
                }
            }
        } catch (error) {
            console.error('MQTT: Error parsing message on', topic, error);
        }
    });

    client.on('close', function () {
        console.log('MQTT: Connection closed');
    });

    client.on('reconnect', function () {
        console.log('MQTT: Reconnecting...');
    });

    client.on('offline', function () {
        console.log('MQTT: Offline');
    });
}


// Function to handle sensor data
function handleSensorData(data) {
    if (humid_gauge) humid_gauge.refresh(data.humidity);
    if (temp_guage) temp_guage.refresh(data.temperature);

    if (thchart) {
        const timeLabel = data.map(item => {
            const date = new Date(item.timestamp);
            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
            const year = date.getFullYear();
            const hours = String(date.getHours()).padStart(2, '0');
            const minutes = String(date.getMinutes()).padStart(2, '0');
            return `${day}-${month}-${year} ${hours}:${minutes}`;
        });
        thchart.data.labels.push(timeLabel);
        thchart.data.datasets[0].data.push(data.temperature);
        thchart.data.datasets[1].data.push(data.humidity);
        if (thchart.data.labels.length > 20) {
            thchart.data.labels.shift();
            thchart.data.datasets[0].data.shift();
            thchart.data.datasets[1].data.shift();
        }
        thchart.update();
    }
}

function handleDeviceState(data) {
    update_led_state(data.pump, 'pump_led'); 
    update_led_state(data.heater, 'heater_led');
    update_led_state(data.fan, 'fan_led');     // Use lowercase 'fan'
    update_led_state(data.mister, 'mister_led'); // Use lowercase 'mister'
    update_led_state(data.lights, 'lights_led'); // Use lowercase 'lights'
}

function update_led_state(state, ledId) {
    const led_element = document.getElementById(ledId);
    
    if (led_element) {
        if (state === 1) {
            led_element.classList.add('green');
            led_element.classList.remove('red');
        } else if (state === 0) {
            led_element.classList.add('red');
            led_element.classList.remove('green');
        } else {
            console.error(`Invalid state: ${state}`);
        }
    } else {
        console.error(`LED element not found: ${ledId}`);
    }
}

function setDeviceState(device, state) {
    if (client && client.connected) {
        const payload = {};
        payload[`${device}_over`] = state;
        const jsonPayload = JSON.stringify(payload);
        client.publish(mqttTopicOverride, jsonPayload, { qos: 0, retain: false });
        console.log('MQTT: Published override for', device, 'to', state, 'on', mqttTopicOverride);
    } else {
        console.error('MQTT: Not connected, cannot publish override.');
    }
}

function setConfig() {
    const tempMinInput = document.getElementById('temp-min');
    const tempMaxInput = document.getElementById('temp-max');
    const humidMinInput = document.getElementById('humid-min');
    const humidMaxInput = document.getElementById('humid-max');
    const fanDurationInputMin = document.getElementById('fan-duration');
    const fanIntervalInputMin = document.getElementById('fan-interval');
    const lightsOnInput = document.getElementById('lights-on-hour');
    const lightsOffInput = document.getElementById('lights-off-hour');

    const config = {};

    if (tempMinInput) {
        config.target_temperature_min = parseFloat(tempMinInput.value);
      } else {
        console.error("Element with id 'temp-min' not found");
        return; // Stop execution if a required element is missing
      }
      if (tempMaxInput) {
        config.target_temperature_max = parseFloat(tempMaxInput.value);
      } else {
        console.error("Element with id 'temp-max' not found");
        return;
      }
      if (humidMinInput) {
        config.target_humidity_min = parseFloat(humidMinInput.value);
      } else {
        console.error("Element with id 'humid-min' not found");
        return;
      }
  
      if (humidMaxInput) {
        config.target_humidity_max = parseFloat(humidMaxInput.value);
      } else {
        console.error("Element with id 'humid-max' not found");
        return;
      }
  
  
      if (fanDurationInputMin) {
          config.fan_run_duration = parseFloat(fanDurationInputMin.value) * 60;
      } else {
        console.error("Element with id 'fan-duration-min' not found");
        return;
      }
      if (fanIntervalInputMin) {
          config.fan_interval = parseFloat(fanIntervalInputMin.value) * 60;
      } else {
         console.error("Element with id 'fan-interval-min' not found");
         return;
      }
  
      if (lightsOnInput) {
          config.lights_on_hour_UTC = parseInt(lightsOnInput.value);
      } else {
         console.error("Element with id 'lights-on-hour' not found");
         return;
      }
  
      if (lightsOffInput) {
          config.lights_off_hour_UTC = parseInt(lightsOffInput.value);
      } else {
         console.error("Element with id 'lights-off-hour' not found");
         return;
      }
  
  
      if (client && client.connected) {
          const jsonPayload = JSON.stringify(config);
          client.publish(mqttTopicConfigSet, jsonPayload, { qos: 0, retain: false });
          console.log('MQTT: Published config change:', config, 'to', mqttTopicConfigSet);
      } else {
          console.error('MQTT: Not connected, cannot publish config.');
      }
  }
  
function updateConfigForm(config) {
    const tempMinInput = document.getElementById('temp-min');
    const tempMaxInput = document.getElementById('temp-max');
    const humidMinInput = document.getElementById('humid-min');
    const humidMaxInput = document.getElementById('humid-max');
    const fanDurationInputMin = document.getElementById('fan-duration');
    const fanIntervalInputMin = document.getElementById('fan-interval');
    const lightsOnInput = document.getElementById('lights-on-hour');
    const lightsOffInput = document.getElementById('lights-off-hour');

    if (tempMinInput) tempMinInput.value = config.target_temperature_min;
    if (tempMaxInput) tempMaxInput.value = config.target_temperature_max;
    if (humidMinInput) humidMinInput.value = config.target_humidity_min;
    if (humidMaxInput) humidMaxInput.value = config.target_humidity_max;
    if (fanDurationInputMin) fanDurationInputMin.value = config.fan_run_duration;
    if (fanIntervalInputMin) fanIntervalInputMin.value = config.fan_interval;
    if (lightsOnInput) lightsOnInput.value = config.lights_on_hour_UTC;
    if (lightsOffInput) lightsOffInput.value = config.lights_off_hour_UTC;
}

document.addEventListener('DOMContentLoaded', function() {
    const ctx = document.getElementById('temp_humid_chart');
    let thchart; // Declare the chart variable outside the function
    const updateInterval = 5 * 60 * 1000; // Update every 5 minutes (in milliseconds)

    function createChart(temperature = [], humidity = [], timeLabel = []) {
        if (thchart) { // Check if a chart instance already exists
            thchart.destroy(); // Destroy the existing chart to update it
        }
        thchart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: timeLabel,
                datasets: [
                    {
                        label: 'Temperature',
                        data: temperature,
                        yAxisID: 'y',
                        borderColor: 'rgba(255, 99, 132, 1)', // Example color
                        backgroundColor: 'rgba(255, 99, 132, 0.2)', // Example background color
                        tension: 0.1 // Smoother lines
                    },
                    {
                        label: 'Humidity',
                        data: humidity,
                        yAxisID: 'y1',
                        borderColor: 'rgba(54, 162, 235, 1)', // Example color
                        backgroundColor: 'rgba(54, 162, 235, 0.2)', // Example background color
                        tension: 0.1 // Smoother lines
                    }
                ]
            },
            options: {
                scales: {
                    y:{
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Temperature (°C)'
                        }
                    },
                    y1:{
                        type: 'linear',
                        display: true,
                        position: 'right',
                        grid: {
                            drawOnChartArea: false // Don't draw grid lines on the chart area
                        },
                        title: {
                            display: true,
                            text: 'Humidity (%)'
                        }
                    },
                    x: {
                        title: {
                            display: true,
                            text: 'Time'
                        }
                    }
                },
                maintainAspectRatio: false,
                responsive: true
            }
        });
    }

    // Function to fetch data from the API
    async function fetchData() {
        try {
            const response = await fetch('/api/sensor_data');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            const formattedTimestamps = data.map(item => {
                const date = new Date(item.timestamp);
                const day = String(date.getDate()).padStart(2, '0');
                const month = String(date.getMonth() + 1).padStart(2, '0'); // Month is 0-indexed
                const year = date.getFullYear();
                const hours = String(date.getHours()).padStart(2, '0');
                const minutes = String(date.getMinutes()).padStart(2, '0');
                return `${hours}:${minutes} ${day}-${month}`; // More concise time format
            });// Format timestamp as needed
            const temperatures = data.map(item => item.temperature);
            const humidities = data.map(item => item.humidity);

            createChart(temperatures, humidities, formattedTimestamps);

        } catch (error) {
            console.error('Error fetching sensor data:', error);
            // Optionally display an error message on the page
        }
    }

    // Call fetchData when the page loads
    fetchData();

    // Periodically update the chart by fetching data again
    setInterval(fetchData, updateInterval);
    humid_gauge = new JustGage({ id: "humid-guage", title: "Humidity", label: "%", value: 0, min: 0, max: 100 });
    temp_guage = new JustGage({ id: "temp-guage", title: "Temperature", label: "°C", value: 0, min: 0, max: 30 });

    connectMQTT();

    function updateTime() {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
        ];
        const month = monthNames[now.getMonth()]; // Month is 0-indexed
        const year = now.getFullYear();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
    
        const formattedTime = `${day} ${month} ${year} - ${hours}:${minutes}`;
    
        document.getElementById('current-time').textContent = formattedTime;
    }

    // Update the time every second (you can adjust the interval)
    setInterval(updateTime, 1000);

    // Initial call to display the time immediately on load
    updateTime();

    const pumpOnButton = document.getElementById('pump-on');
    const pumpOffButton = document.getElementById('pump-off');
    const pumpAutoButton = document.getElementById('pump-auto');
    const heaterOnButton = document.getElementById('heater-on');
    const heaterOffButton = document.getElementById('heater-off');
    const heaterAutoButton = document.getElementById('heater-auto');
    const fanOnButton = document.getElementById('fan-on');
    const fanOffButton = document.getElementById('fan-off');
    const fanAutoButton = document.getElementById('fan-auto');
    const misterOnButton = document.getElementById('mister-on');
    const misterOffButton = document.getElementById('mister-off');
    const misterAutoButton = document.getElementById('mister-auto');
    const lightsOnButton = document.getElementById('lights-on');
    const lightsOffButton = document.getElementById('lights-off');
    const lightsAutoButton = document.getElementById('lights-auto');

    if (pumpOnButton) pumpOnButton.addEventListener('click', () => setDeviceState('pump', 'on'));
    if (pumpOffButton) pumpOffButton.addEventListener('click', () => setDeviceState('pump', 'off'));
    if (pumpAutoButton) pumpAutoButton.addEventListener('click', () => setDeviceState('pump', 'no override'));
    if (heaterOnButton) heaterOnButton.addEventListener('click', () => setDeviceState('heater', 'on'));
    if (heaterOffButton) heaterOffButton.addEventListener('click', () => setDeviceState('heater', 'off'));
    if (heaterAutoButton) heaterAutoButton.addEventListener('click', () => setDeviceState('heater', 'no override'));
    if (fanOnButton) fanOnButton.addEventListener('click', () => setDeviceState('fan', 'on'));
    if (fanOffButton) fanOffButton.addEventListener('click', () => setDeviceState('fan', 'off'));
    if (fanAutoButton) fanAutoButton.addEventListener('click', () => setDeviceState('fan', 'no override'));
    if (misterOnButton) misterOnButton.addEventListener('click', () => setDeviceState('mister', 'on'));
    if (misterOffButton) misterOffButton.addEventListener('click', () => setDeviceState('mister', 'off'));
    if (misterAutoButton) misterAutoButton.addEventListener('click', () => setDeviceState('mister', 'no override'));
    if (lightsOnButton) lightsOnButton.addEventListener('click', () => setDeviceState('lights', 'on'));
    if (lightsOffButton) lightsOffButton.addEventListener('click', () => setDeviceState('lights', 'off'));
    if (lightsAutoButton) lightsAutoButton.addEventListener('click', () => setDeviceState('lights', 'no override'));

    const configButton = document.getElementById('config-button');
    if (configButton) {
        configButton.addEventListener('click', () => {
            setConfig();
            initialConfigLoaded = true; // Set the flag after user interaction
            if (client && client.connected) {
                client.unsubscribe(mqttTopicConfigStatus);
                console.log('MQTT: Unsubscribed from', mqttTopicConfigStatus);
            }
        });
    }
});