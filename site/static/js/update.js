let humid_gauge;
let temp_guage;
let thchart;
let initialConfigLoaded = false;
let currentDeviceState = {}; // To store the latest device state

// MQTT Configuration
const mqttBroker = 'ws://192.168.1.170:9001';
const mqttClientId = 'web-client-' + Math.random().toString(16).substr(2, 8);
const mqttTopicSensors = 'farm/sensors/sensors';
const mqttTopicDevices = 'farm/sensors/devices';
const mqttTopicOverride = 'farm/sensors/override';
const mqttTopicConfigSet = 'farm/sensors/config';
const mqttTopicConfigStatus = 'farm/sensors/status';
const mqttTopicAlerts = 'farm/sensors/alerts';

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
        client.subscribe(mqttTopicAlerts, { qos: 0 }, function (err) { // Add this
            if (err) {
                console.error('MQTT: Error subscribing to', mqttTopicAlerts, err);
            } else {
                console.log('MQTT: Subscribed to', mqttTopicAlerts);
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
                currentDeviceState = data; // Store the latest device state
                handleDeviceState(data);
                updateOverrideButtonStates(data); // Update button states
            } else if (topic === mqttTopicConfigStatus) {
                if (!initialConfigLoaded) {
                    updateConfigForm(data);
                    initialConfigLoaded = true;
                    client.unsubscribe(mqttTopicConfigStatus);
                    console.log('MQTT: Unsubscribed from', mqttTopicConfigStatus);
                }
            } else if (topic === mqttTopicAlerts) {
                handleAlert(payload.toString());
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
    console.log("Humidity received:", data.humidity, typeof data.humidity);
    if (humid_gauge) {
      console.log("Refreshing humid_gauge with:", data.humidity); //debugging 
      humid_gauge.refresh(data.humidity);
    }
    if (temp_guage) temp_guage.refresh(data.temperature);
}

function handleDeviceState(data) {
    update_led_state(data.pump, 'pump_led');
    update_led_state(data.heater, 'heater_led');
    update_led_state(data.fan, 'fan_led');
    update_led_state(data.mister, 'mister_led');
    update_led_state(data.lights, 'lights_led');
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
    const fanDurationInput = document.getElementById('fan-duration');
    const fanIntervalInput = document.getElementById('fan-interval');
    const lightsOnInput = document.getElementById('lights-on-hour');
    const lightsOffInput = document.getElementById('lights-off-hour');

    const config = {};

    if (tempMinInput) {
        config.target_temperature_min = parseFloat(tempMinInput.value);
    } else {
        console.error("Element with id 'temp-min' not found");
        return;
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


    if (fanDurationInput) {
        // Use the same property name as updateConfigForm expects
        config.fan_run_duration_minutes = parseFloat(fanDurationInput.value);
   } else {
        console.error("Element with id 'fan-duration' not found"); // Corrected error message
        return;
   }
   if (fanIntervalInput) {
        // Use the same property name as updateConfigForm expects
        config.fan_interval_minutes = parseFloat(fanIntervalInput.value);
   } else {
        console.error("Element with id 'fan-interval' not found"); // Corrected error message
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
    const fanDurationInput = document.getElementById('fan-duration');
    const fanIntervalInput = document.getElementById('fan-interval');
    const lightsOnInput = document.getElementById('lights-on-hour');
    const lightsOffInput = document.getElementById('lights-off-hour');

    if (tempMinInput) tempMinInput.value = config.target_temperature_min;
    if (tempMaxInput) tempMaxInput.value = config.target_temperature_max;
    if (humidMinInput) humidMinInput.value = config.target_humidity_min;
    if (humidMaxInput) humidMaxInput.value = config.target_humidity_max;
    if (fanDurationInput) fanDurationInput.value = config.fan_run_duration_minutes;
    if (fanIntervalInput) fanIntervalInput.value = config.fan_interval_minutes;
    if (lightsOnInput) lightsOnInput.value = config.lights_on_hour_UTC;
    if (lightsOffInput) lightsOffInput.value = config.lights_off_hour_UTC;
}

function handleAlert(alertMessage) {
    console.warn('Received Alert:', alertMessage);
    const alertContainer = document.getElementById('alert-container');
    if (alertContainer) {
        const alertDiv = document.createElement('div');
        alertDiv.className = 'alert alert-danger';
        alertDiv.textContent = alertMessage;
        alertContainer.appendChild(alertDiv);

        setTimeout(() => alertDiv.remove(), 5000);
    } else {
        console.error('alert-container not found');
        alert(alertMessage)
    }
}

 // *** CORRECTED FUNCTION ***
 // This function now disables the button that represents the current active override state.
 function setButtonState(buttonId, isActiveState) {
    const button = document.getElementById(buttonId);
    if (button) {
        // Disable the button if it represents the current state (isActiveState is true)
        button.disabled = isActiveState;

        // Add/remove the 'disabled' class for styling based on the button's disabled status
        if (button.disabled) {
            button.classList.add('disabled'); // Style as disabled/inactive
        } else {
            button.classList.remove('disabled'); // Style as enabled/active
        }
    } else {
         console.error(`Button element not found: ${buttonId}`);
    }
}

function updateOverrideButtonStates(deviceState) {
    const getOverride = (dev) => deviceState[`${dev}_over`] || "no override";

    const pumpOverride = getOverride('pump');
    const heaterOverride = getOverride('heater');
    const fanOverride = getOverride('fan');
    const misterOverride = getOverride('mister');
    const lightsOverride = getOverride('lights');

    // --- Pump Buttons ---
    // Disable 'pump-on' if pumpOverride is 'on'
    setButtonState('pump-on', pumpOverride === 'on');
    setButtonState('pump-off', pumpOverride === 'off');
    setButtonState('pump-auto', pumpOverride === 'no override');

    // --- Heater Buttons ---
    setButtonState('heater-on', heaterOverride === 'on');
    setButtonState('heater-off', heaterOverride === 'off');
    setButtonState('heater-auto', heaterOverride === 'no override');

    // --- Fan Buttons ---
    setButtonState('fan-on', fanOverride === 'on');
    setButtonState('fan-off', fanOverride === 'off');
    setButtonState('fan-auto', fanOverride === 'no override');

    // --- Mister Buttons ---
    setButtonState('mister-on', misterOverride === 'on');
    setButtonState('mister-off', misterOverride === 'off');
    setButtonState('mister-auto', misterOverride === 'no override');

    // --- Lights Buttons ---
    setButtonState('lights-on', lightsOverride === 'on');
    setButtonState('lights-off', lightsOverride === 'off');
    setButtonState('lights-auto', lightsOverride === 'no override');
}

document.addEventListener('DOMContentLoaded', function () {
    const ctx = document.getElementById('temp_humid_chart');
    let thchart;
    const updateInterval = 5 * 60 * 1000;

    function createChart(temperature = [], humidity = [], timeLabel = []) {
        if (thchart) {
            thchart.destroy();
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
                        borderColor: 'rgba(255, 99, 132, 1)',
                        backgroundColor: 'rgba(255, 99, 132, 0.2)',
                        tension: 0.1
                    },
                    {
                        label: 'Humidity',
                        data: humidity,
                        yAxisID: 'y1',
                        borderColor: 'rgba(54, 162, 235, 1)',
                        backgroundColor: 'rgba(54, 162, 235, 0.2)',
                        tension: 0.1
                    }
                ]
            },
            options: {
                scales: {
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Temperature (°C)'
                        }
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        grid: {
                            drawOnChartArea: false
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

    async function fetchData() {
        try {
            const response = await fetch('/api/sensor_data');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();

            const formattedTimestamps = data.map(item => item.timestamp);
            const temperatures = data.map(item => item.temperature);
            const humidities = data.map(item => item.humidity);

            createChart(temperatures, humidities, formattedTimestamps);

        } catch (error) {
            console.error('Error fetching sensor data:', error);
        }
    }

    fetchData();
    setInterval(fetchData, updateInterval);
    humid_gauge = new JustGage({ 
        id: "humid-guage", 
        label: "Humidity", 
        decimals: 2,
        valueFontFamily: "Ubuntu Mono",
        min: 0, 
        max: 100,
        value: 0,
        pointer: true,
        symbol: "%",
        gaugeWidthScale: 0.6,
        customSectors: {
            percents: true,
            ranges: [
              {lo: 0, hi: 60, color: '#FF4500'},
              {lo: 61, hi: 75, color: '#FFA500'},
              {lo: 76, hi: 90, color: '#00FF00'},
              {lo: 91, hi: 100, color: '#2E8B57'}
            ],
            levelColorGradient: false
          },
        counter: true
    });
    temp_guage = new JustGage({ 
        id: "temp-guage",  
        label: "Temperature", 
        value: 0, 
        min: 0, 
        max: 30,
        decimals: 2,
        valueFontFamily: "Ubuntu Mono",
        pointer: true,
        symbol: "°C",
        gaugeWidthScale: 0.6,
        customSectors: {
            ranges: [
              {lo: 0, hi: 5, color: '#2E8B57'}, 
              {lo: 6, hi: 12, color: '#228B22'},
              {lo: 13, hi: 19, color: '#00FF00'},
              {lo: 20, hi: 24, color: '#FFA500'},
              {lo: 25, hi: 30, color: '#FF4500'}
            ],
            levelColorGradient: false
          },
        counter: true

    
    });

    connectMQTT();

    function updateTime() {
        const now = new Date();
        const day = String(now.getDate()).padStart(2, '0');
        const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
            "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
        ];
        const month = monthNames[now.getMonth()];
        const year = now.getFullYear();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');

        const formattedTime = `${day} ${month} ${year} - ${hours}:${minutes}`;

        document.getElementById('current-time').textContent = formattedTime;
    }

    setInterval(updateTime, 1000);
    updateTime();

 // --- Add Event Listeners for Override Buttons ---
     // Helper function to add listeners safely
     const addButtonListener = (id, device, state) => {
        const button = document.getElementById(id);
        if (button) {
            button.addEventListener('click', () => setDeviceState(device, state));
        } else {
            console.error(`Button element not found: ${id}`);
        }
    };

    // Pump
    addButtonListener('pump-on', 'pump', 'on');
    addButtonListener('pump-off', 'pump', 'off');
    addButtonListener('pump-auto', 'pump', 'no override');

    // Heater
    addButtonListener('heater-on', 'heater', 'on');
    addButtonListener('heater-off', 'heater', 'off');
    addButtonListener('heater-auto', 'heater', 'no override');

    // Fan
    addButtonListener('fan-on', 'fan', 'on');
    addButtonListener('fan-off', 'fan', 'off');
    addButtonListener('fan-auto', 'fan', 'no override');

    // Mister
    addButtonListener('mister-on', 'mister', 'on');
    addButtonListener('mister-off', 'mister', 'off');
    addButtonListener('mister-auto', 'mister', 'no override');

    // Lights
    addButtonListener('lights-on', 'lights', 'on');
    addButtonListener('lights-off', 'lights', 'off');
    addButtonListener('lights-auto', 'lights', 'no override');

    const configButton = document.getElementById('config-button');
    if (configButton) {
        configButton.addEventListener('click', () => {
            setConfig();
            initialConfigLoaded = true;
            if (client && client.connected) {
                client.unsubscribe(mqttTopicConfigStatus);
                console.log('MQTT: Unsubscribed from', mqttTopicConfigStatus);
            }
        });
    }
});
