let humid_gauge;
let temp_guage;
let thchart;
let initialConfigLoaded = false;
let currentDeviceState = {}; 
let DEVICE_POWER_WATTS = {
    pump: 50,
    heater: 150,
    mister: 30,
    lights: 20,
    fan: 25
};
const mqttBroker = 'ws://192.168.1.170:9001';
const mqttClientId = 'web-client-' + Math.random().toString(16).substr(2, 8);
const mqttTopicSensors = 'farm/sensors/sensors';
const mqttTopicDevices = 'farm/sensors/devices';
const mqttTopicOverride = 'farm/sensors/override';
const mqttTopicConfigSet = 'farm/sensors/config';
const mqttTopicConfigStatus = 'farm/sensors/status';
const mqttTopicAlerts = 'farm/sensors/alerts';
const LOCAL_STORAGE_WATTS_KEY = 'deviceWattages';
let latestDeviceStateData = null;

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
        client.subscribe(mqttTopicAlerts, { qos: 0 }, function (err) { 
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
        const rawPayloadString = payload.toString().trim();
        console.log(`MQTT: Received message on ${topic}. Payload: ${rawPayloadString}"`);
    
        if (topic === mqttTopicSensors) {
            try {
                const data = JSON.parse(rawPayloadString);
                console.log('MQTT: Parsed sensor data:', data);
                handleSensorData(data);
            } catch (error) {
                console.error('MQTT: Error parsing JSON message on farm/sensors/sensors:', error, " payload:", rawPayloadString);
            }
        } else if (topic === mqttTopicDevices) {
            try {
                const data = JSON.parse(rawPayloadString);
                console.log('MQTT: Parsed device data for farm/sensors/devices:', data);
                currentDeviceState = data;     
                handleDeviceState(currentDeviceState);    
                updateOverrideButtonStates(currentDeviceState); 
    
            } catch (error) {
                console.error('MQTT: Error parsing JSON message on farm/sensors/devices:', error, "payload:", rawPayloadString);
  
            }
        } else if (topic === mqttTopicConfigStatus) {
            if (!initialConfigLoaded) {
                try {
                    const data = JSON.parse(rawPayloadString);
                    console.log('MQTT: Parsed config status data:', data);
                    updateConfigForm(data);
                    initialConfigLoaded = true;
                } catch (error) {
                    console.error('MQTT: Error parsing JSON message on farm/sensors/status:', error, "payload:", rawPayloadString);
                }
            }
        } else if (topic === mqttTopicAlerts) {
            handleAlert(rawPayloadString);
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

function handleSensorData(data) {
    console.log("Humidity received:", data.humidity, typeof data.humidity);
    if (humid_gauge) {
      console.log("Refreshing humid_gauge with:", data.humidity); //debugging 
      humid_gauge.refresh(data.humidity);
    }
    if (temp_guage) temp_guage.refresh(data.temperature);

    const dailyHumidHighElement = document.getElementById('daily-humid-high');
    const dailyHumidLowElement = document.getElementById('daily-humid-low');
    const dailyTempHighElement = document.getElementById('daily-temp-high');
    const dailyTempLowElement = document.getElementById('daily-temp-low');

    if (dailyHumidHighElement && data.daily_high_humidity !== undefined) {
        dailyHumidHighElement.textContent = `High: ${data.daily_high_humidity.toFixed(1)}%`;
    }
    if (dailyHumidLowElement && data.daily_low_humidity !== undefined) {
        dailyHumidLowElement.textContent = `Low: ${data.daily_low_humidity.toFixed(1)}%`;
    }
    if (dailyTempHighElement && data.daily_high_temp !== undefined) {
        dailyTempHighElement.textContent = `High: ${data.daily_high_temp.toFixed(1)}°C`;
    }
    if (dailyTempLowElement && data.daily_low_temp !== undefined) {
        dailyTempLowElement.textContent = `Low: ${data.daily_low_temp.toFixed(1)}°C`;
    }
}

function handleDeviceState(data, recalculateOnlyParam) {
    const recalculateOnly = recalculateOnlyParam || false; 


    console.log("handleDeviceState called. Data:", data, "Recalculate only:", recalculateOnly); // DEBUG
    if (!data) return;

    if (!recalculateOnly) {
        if (data.hasOwnProperty('pump')) update_led_state(data.pump, 'pump_led');
        if (data.hasOwnProperty('heater')) update_led_state(data.heater, 'heater_led');
        if (data.hasOwnProperty('fan')) update_led_state(data.fan, 'fan_led');
        if (data.hasOwnProperty('mister')) update_led_state(data.mister, 'mister_led');
        if (data.hasOwnProperty('lights')) update_led_state(data.lights, 'lights_led');
        console.log("LED states updated (not a recalculation)."); // DEBUG
    } else {
        console.log("Skipping LED state updates (recalculation only)."); // DEBUG
    }


    const pumpTimeOnElement = document.getElementById('pump-time-on');
    const misterTimeOnElement = document.getElementById('mister-time-on');
    const heaterTimeOnElement = document.getElementById('heater-time-on');
    const lightTimeOnElement = document.getElementById('light-time-on');
    const fanTimeOnElement = document.getElementById('fan-time-on');

    const pumpEnergyElement = document.getElementById('pump-energy-kwh');
    const misterEnergyElement = document.getElementById('mister-energy-kwh');
    const heaterEnergyElement = document.getElementById('heater-energy-kwh');
    const lightsEnergyElement = document.getElementById('lights-energy-kwh');
    const fanEnergyElement = document.getElementById('fan-energy-kwh');

    function updateDeviceCurrentDisplay(deviceType, timeOnKey, timeOnElement, energyElement) {
        console.log(`Attempting to update current display for: ${deviceType}`); // DEBUG
        console.log(`  Time On Key: ${timeOnKey}, Element:`, timeOnElement, `Energy Element:`, energyElement); // DEBUG

        if (timeOnElement && data.hasOwnProperty(timeOnKey)) {
            const timeOnString = data[timeOnKey]; // "HH:MM" string from MQTT
            timeOnElement.textContent = timeOnString;
            console.log(`  Found time string: ${timeOnString}`); // DEBUG

            if (energyElement && DEVICE_POWER_WATTS[deviceType] !== undefined) {
                const parts = timeOnString.split(':');
                const hours = parseInt(parts[0], 10);
                const minutes = parseInt(parts[1], 10);

                if (isNaN(hours) || isNaN(minutes)) {
                    console.warn(`Invalid HH:MM format for ${deviceType}: ${timeOnString}`);
                    energyElement.textContent = 'N/A';
                    return;
                }

                const totalHours = hours + (minutes / 60);
                const powerWatts = DEVICE_POWER_WATTS[deviceType];
                const energyKwh = (powerWatts * totalHours) / 1000;
                energyElement.textContent = `${energyKwh.toFixed(2)} kWh`;
                console.log(`  ${deviceType} Energy Calculated: ${energyKwh.toFixed(2)} kWh`); // DEBUG
            } else if (energyElement) {
                energyElement.textContent = 'N/A (Missing Wattage)';
                console.warn(`  ${deviceType} Wattage not defined or energyElement not found. Current DEVICE_POWER_WATTS:`, DEVICE_POWER_WATTS); // DEBUG
            }
        } else {
            console.warn(`  ${deviceType} Time-on element or data property not found.`); // DEBUG
            if (timeOnElement) timeOnElement.textContent = '--:--';
            if (energyElement) energyElement.textContent = '0.00 kWh';
        }
    }

    updateDeviceCurrentDisplay('pump', 'pump_time_on', pumpTimeOnElement, pumpEnergyElement);
    updateDeviceCurrentDisplay('mister', 'mister_time_on', misterTimeOnElement, misterEnergyElement);
    updateDeviceCurrentDisplay('heater', 'heater_time_on', heaterTimeOnElement, heaterEnergyElement);
    updateDeviceCurrentDisplay('lights', 'lights_time_on', lightTimeOnElement, lightsEnergyElement);
    updateDeviceCurrentDisplay('fan', 'fan_time_on', fanTimeOnElement, fanEnergyElement);

    if (!recalculateOnly) {
    currentDeviceState = data;
    updateOverrideButtonStates(currentDeviceState);
    console.log("Mode and override states updated (not a recalculation).");

    setConfigInputDisplayAndState(currentDeviceState.mode_over);
}


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
            console.warn(`Invalid state: ${state} for LED ${ledId}. Expected 0 or 1.`);
            led_element.classList.add('red');
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

let isConfigEditing = false; 

const tempMinInput = document.getElementById('temp-min-input'); // Updated ID
const tempMinDisplay = document.getElementById('temp-min-display'); // NEW
const tempMaxInput = document.getElementById('temp-max-input');
const tempMaxDisplay = document.getElementById('temp-max-display');
const humidMinInput = document.getElementById('humid-min-input');
const humidMinDisplay = document.getElementById('humid-min-display');
const humidMaxInput = document.getElementById('humid-max-input');
const humidMaxDisplay = document.getElementById('humid-max-display');
const fanDurationInput = document.getElementById('fan-duration-input');
const fanDurationDisplay = document.getElementById('fan-duration-display');
const fanIntervalInput = document.getElementById('fan-interval-input');
const fanIntervalDisplay = document.getElementById('fan-interval-display');
const lightsOnInput = document.getElementById('lights-on-hour-input');
const lightsOnDisplay = document.getElementById('lights-on-hour-display');
const lightsOffInput = document.getElementById('lights-off-hour-input');
const lightsOffDisplay = document.getElementById('lights-off-hour-display');

const allConfigControls = [
    { htmlId: 'temp-min', jsonKey: 'target_temperature_min', input: tempMinInput, display: tempMinDisplay, type: 'float', unit: '°C' },
    { htmlId: 'temp-max', jsonKey: 'target_temperature_max', input: tempMaxInput, display: tempMaxDisplay, type: 'float', unit: '°C' },
    { htmlId: 'humid-min', jsonKey: 'target_humidity_min', input: humidMinInput, display: humidMinDisplay, type: 'float', unit: '%' },
    { htmlId: 'humid-max', jsonKey: 'target_humidity_max', input: humidMaxInput, display: humidMaxDisplay, type: 'float', unit: '%' },
    { htmlId: 'fan-duration', jsonKey: 'fan_run_duration_minutes', input: fanDurationInput, display: fanDurationDisplay, type: 'float', unit: ' min' },
    { htmlId: 'fan-interval', jsonKey: 'fan_interval_minutes', input: fanIntervalInput, display: fanIntervalDisplay, type: 'float', unit: ' min' },
    { htmlId: 'lights-on-hour', jsonKey: 'lights_on_hour_UTC', input: lightsOnInput, display: lightsOnDisplay, type: 'int', unit: ':00' },
    { htmlId: 'lights-off-hour', jsonKey: 'lights_off_hour_UTC', input: lightsOffInput, display: lightsOffDisplay, type: 'int', unit: ':00' }
];

function setConfigInputDisplayAndState(mode) {
 
    allConfigControls.forEach(control => {
        if (control.input && control.display) {
            if (isConfigEditing) {
                control.display.style.display = 'none';
                control.input.style.display = 'inline';
            } else {
                control.display.style.display = 'inline';
                control.input.style.display = 'none';
            }

            let shouldBeDisabled = !isConfigEditing; 

            if (mode === "colonisation" &&
                (control.htmlId === 'humid-min' || control.htmlId === 'humid-max' ||
                 control.htmlId === 'lights-on-hour' || control.htmlId === 'lights-off-hour')) {
                shouldBeDisabled = true;
            }
            control.input.disabled = shouldBeDisabled;
        }
    });

    if (mode === "colonisation") {
        console.log('Config options: Humidity and Lights DISABLED due to Colonisation mode (others enabled if editing).');
    } else {
        console.log('Config options: All ENABLED due to Fruiting mode (respecting edit mode).');
    }
}

function toggleConfigEditMode() {
    isConfigEditing = !isConfigEditing;

    const configToggleButton = document.getElementById('config-toggle-button');

    configToggleButton.textContent = isConfigEditing ? 'Apply Configuration' : 'Edit Configuration';
    configToggleButton.classList.remove('disabled'); 

    setConfigInputDisplayAndState(currentDeviceState.mode_over);

    if (!isConfigEditing) { 
        console.log('Exited configuration edit mode. Applying changes...');
        setConfig(); 
    } else { 
        console.log('Entered configuration edit mode.');
    }
}



function setConfig() {
    const config = {};

    allConfigControls.forEach(control => {
        if (control.input) {
            let value;
            if (control.type === 'float') {
                value = parseFloat(control.input.value);
            } else if (control.type === 'int') {
                value = parseInt(control.input.value);
            }

            if (!isNaN(value)) {
                config[control.jsonKey] = value; 
            } else {
                console.error(`Invalid input for ${control.label}. Value: ${control.input.value}`);
                alert(`Invalid input for ${control.label}. Please enter a valid number.`);
                isConfigEditing = true; 
                setConfigInputDisplayAndState(currentDeviceState.mode_over);
                return;
            }
        } else {
            console.error(`Input element for ${control.label} not found.`);
            return;
        }
    });

    if (client && client.connected) {
        const jsonPayload = JSON.stringify(config);
        client.publish(mqttTopicConfigSet, jsonPayload, { qos: 0, retain: false });
        console.log('MQTT: Published config change:', config, 'to', mqttTopicConfigSet);

    } else {
        console.error('MQTT: Not connected, cannot publish config.');
        isConfigEditing = true; 
        setConfigInputDisplayAndState(currentDeviceState.mode_over);
        alert("MQTT not connected. Cannot apply configuration. Please check connection.");
    }
}

function updateConfigForm(config) {
    if (!isConfigEditing) {
        allConfigControls.forEach(control => {
            if (control.input && control.display && config.hasOwnProperty(control.jsonKey)) {
                const value = config[control.jsonKey];
                control.input.value = value; 
                control.display.textContent = `${value}${control.unit || ''}`;
            }
        });
        console.log('Configuration form updated from MQTT status.');
    } else {
        console.log('Configuration form update from MQTT status skipped (in edit mode).');
    }
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


 function setButtonState(buttonId, isActiveState) {
    const button = document.getElementById(buttonId);
    if (button) {
        button.disabled = isActiveState;

        if (button.disabled) {
            button.classList.add('disabled'); 
        } else {
            button.classList.remove('disabled'); 
        }
    } else {
         console.error(`Button element not found: ${buttonId}`);
    }
}

function updateOverrideButtonStates(deviceState) {
    if (!deviceState) {
        console.warn("updateOverrideButtonStates called with undefined deviceState");
        return;
    }

    const getOverride = (dev) => deviceState[`${dev}_over`] || "no override"; 
    const currentMode = deviceState.mode_over || "fruiting"; 

    // overright  buttons
    setButtonState('mode-fruiting-button', currentMode === 'fruiting');
    setButtonState('mode-colonisation-button', currentMode === 'colonisation');

    const pumpOverride = getOverride('pump');
    const heaterOverride = getOverride('heater');
    const fanOverride = getOverride('fan');
    const misterOverride = getOverride('mister');
    const lightsOverride = getOverride('lights');

    setButtonState('pump-on', pumpOverride === 'on');
    setButtonState('pump-off', pumpOverride === 'off');
    setButtonState('pump-auto', pumpOverride === 'no override' || pumpOverride === '');

    setButtonState('heater-on', heaterOverride === 'on');
    setButtonState('heater-off', heaterOverride === 'off');
    setButtonState('heater-auto', heaterOverride === 'no override' || heaterOverride === '');

    setButtonState('fan-on', fanOverride === 'on');
    setButtonState('fan-off', fanOverride === 'off');
    setButtonState('fan-auto', fanOverride === 'no override' || fanOverride === '');

    setButtonState('mister-on', misterOverride === 'on');
    setButtonState('mister-off', misterOverride === 'off');
    setButtonState('mister-auto', misterOverride === 'no override' || misterOverride === '');

    setButtonState('lights-on', lightsOverride === 'on');
    setButtonState('lights-off', lightsOverride === 'off');
    setButtonState('lights-auto', lightsOverride === 'no override' || lightsOverride === '');
}

function loadWattagesFromLocalStorage() {
    try {
        const storedWatts = localStorage.getItem(LOCAL_STORAGE_WATTS_KEY);
        if (storedWatts) {
            const parsedWatts = JSON.parse(storedWatts);

            Object.assign(DEVICE_POWER_WATTS, parsedWatts);
            console.log('Loaded wattages from local storage:', DEVICE_POWER_WATTS);
        }
    } catch (e) {
        console.error("Error loading wattages from local storage:", e);
        localStorage.removeItem(LOCAL_STORAGE_WATTS_KEY);
    }
}

function saveWattagesToLocalStorage() {
    try {
        localStorage.setItem(LOCAL_STORAGE_WATTS_KEY, JSON.stringify(DEVICE_POWER_WATTS));
        console.log('Saved wattages to local storage:', DEVICE_POWER_WATTS);
    } catch (e) {
        console.error("Error saving wattages to local storage:", e);
    }
}

function initializeWattageInputs() {
    ['pump', 'heater', 'mister', 'lights', 'fan'].forEach(device => {
        const displayElement = document.getElementById(`${device}-wattage-display`);
        const inputElement = document.getElementById(`${device}-wattage-input`);
        const toggleButton = document.getElementById(`${device}-wattage-toggle-button`);
        let isEditing = false;

        function setWattageUiState() {
            if (isEditing) {
                displayElement.style.display = 'none';
                inputElement.style.display = 'inline';
                inputElement.value = DEVICE_POWER_WATTS[device];
                toggleButton.textContent = 'Save';
                inputElement.focus();
            } else {
                displayElement.textContent = `${DEVICE_POWER_WATTS[device]} W`;
                displayElement.style.display = 'inline';
                inputElement.style.display = 'none';
                toggleButton.textContent = 'Edit';
            }
        }

        toggleButton.addEventListener('click', () => {
            if (isEditing) {
                const newWattage = parseFloat(inputElement.value);

                if (!isNaN(newWattage) && newWattage >= 0) {
                    DEVICE_POWER_WATTS[device] = newWattage;
                    saveWattagesToLocalStorage(); 
                    recalculateAllEnergyDisplays();
                    isEditing = false;
                } else {
                    alert(`Invalid wattage entered for ${device}. Please enter a non-negative number.`);
                    inputElement.value = DEVICE_POWER_WATTS[device]; 
                    return;
                }
            } else {
                isEditing = true;
            }
            setWattageUiState();
        });
        setWattageUiState();
    });
}

function recalculateAllEnergyDisplays() {
    console.log("Recalculating all energy displays with new wattages...");
    if (latestDeviceStateData) {
        handleDeviceState(latestDeviceStateData, true);
    }
    fetchAndDisplayHistoricalEnergy();
}

function formatSecondsToHhMm(totalSeconds) {
    if (totalSeconds === undefined || totalSeconds < 0) {
        return "--:--";
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

const apiDailyDeviceTimes = '/api/device_daily_times';


async function fetchAndDisplayHistoricalEnergy() {
    try {
        const response = await fetch(`${apiDailyDeviceTimes}?days=7`); // Fetch last 7 days
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json(); 

        const tableBody = document.querySelector('#daily-energy-table tbody');
        if (!tableBody) {
            console.error("Historical energy table body not found.");
            return;
        }

        tableBody.innerHTML = '';

        if (data.length === 0) {
            console.warn("No historical data received from API. Table will be empty.");
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No historical data available. Please seed the database.</td></tr>';
        }

        data.forEach(dayData => {
            const row = tableBody.insertRow();
            row.insertCell().textContent = dayData.date; 

            const devices = ['pump', 'mister', 'heater', 'lights', 'fan'];
            devices.forEach(device => {
                const timeOnSeconds = dayData[`${device}_time_on`]; 

                const powerWatts = DEVICE_POWER_WATTS[device];

                const cell = row.insertCell();

                const formattedTime = formatSecondsToHhMm(timeOnSeconds);
                cell.innerHTML = `<strong>${formattedTime}</strong><br>`; 

                let energyKwh = 0;
                if (powerWatts && timeOnSeconds !== undefined) {
                    const totalHours = timeOnSeconds / 3600; 
                    energyKwh = (powerWatts * totalHours) / 1000; // Energy (kWh) = Power (W) * Time (h) / 1000
                }
                cell.innerHTML += `(${energyKwh.toFixed(2)} kWh)`;
            });
        });

    } catch (error) {
        console.error('Error fetching historical device times:', error);
    }
}

document.addEventListener('DOMContentLoaded', function () {

    loadWattagesFromLocalStorage(); // load watts from localStorage first
    initializeWattageInputs(); 

    humid_gauge = new JustGage({ 
        id: "humid-guage", 
        label: "Humidity", 
        decimals: 2,
        valueFontFamily: "DotGothic16",
        labelFontFaimly: "DotGothic16",
        min: 0, 
        max: 100,
        value: 0,
        symbol: "%",
        gaugeWidthScale: 0.3,
        relativeGaugeSize: true,
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
        valueFontFamily: "DotGothic16",
        symbol: "°C",
        gaugeWidthScale: 0.3,
        relativeGaugeSize: true,
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

    fetchAndDisplayHistoricalEnergy();
    setInterval(fetchAndDisplayHistoricalEnergy, 60 * 60 * 1000);

    const ctx = document.getElementById('temp_humid_chart');
    let thchart;
    const updateInterval = 5 * 60 * 1000;
    Chart.defaults.font.family = "Space Grotesk";
    Chart.defaults.font.size = 18;

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


    const fruitingButton = document.getElementById('mode-fruiting-button');
    if (fruitingButton) {
        fruitingButton.addEventListener('click', () => {
            setDeviceState('mode', 'fruiting');
        });
    } else {
        console.error("Button element not found: mode-fruiting-button");
    }

    const colonisationButton = document.getElementById('mode-colonisation-button');
    if (colonisationButton) {
        colonisationButton.addEventListener('click', () => {
            setDeviceState('mode', 'colonisation');
        });
    } else {
        console.error("Button element not found: mode-colonisation-button");
    }

    const addButtonListener = (id, device, state) => {
        const button = document.getElementById(id);
        if (button) {
            button.addEventListener('click', () => setDeviceState(device, state));
        } else {
            console.error(`Button element not found: ${id}`);
        }
    };

    ['pump', 'heater', 'fan', 'mister', 'lights'].forEach(device => {
        addButtonListener(`${device}-on`, device, 'on');
        addButtonListener(`${device}-off`, device, 'off');
        addButtonListener(`${device}-auto`, device, 'no override');
    });

    const configToggleButton = document.getElementById('config-toggle-button');
    if (configToggleButton) {
        configToggleButton.addEventListener('click', toggleConfigEditMode);
        configToggleButton.textContent = 'Edit Configuration';
    } else {
        console.error("Config toggle button not found: config-toggle-button");
    }

    setConfigInputDisplayAndState("fruiting");

});
