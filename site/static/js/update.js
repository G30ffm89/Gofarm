const mqttBroker = 'ws://192.168.1.170:9001'; //websocket broker url
const mqttClientId = 'web-client-' + Math.random().toString(16).substr(2, 8); //creates unique id for each session
const mqttTopicSensors = 'farm/sensors/sensors'; //live temp/humid data
const mqttTopicDevices = 'farm/sensors/devices'; //on/off status, overrides and run times for devies
const mqttTopicOverride = 'farm/sensors/override';
const mqttTopicConfigSet = 'farm/sensors/config';
const mqttTopicConfigStatus = 'farm/sensors/status';
const mqttTopicAlerts = 'farm/sensors/alerts';
const LOCAL_STORAGE_WATTS_KEY = 'deviceWattages'; //key to save custom wattage

let humid_gauge;
let temp_guage;
let initialConfigLoaded = false; //prevents config from being reloaded every time a request is sent
let currentDeviceState = {}; //stores the most recent device state json objects from go
let latestDeviceStateData = null;
let isConfigEditing = false; 

let DEVICE_POWER_WATTS = { //object to host the watts for each device 
    pump: 50,
    heater: 150,
    mister: 30,
    lights: 20,
    fan: 25
};

const allConfigControls = [ //array of objects or the config panel htmlid is for the go backend
    { htmlId: 'temp-min', jsonKey: 'target_temperature_min', input: null, display: null, type: 'float', unit: '°C' },
    { htmlId: 'temp-max', jsonKey: 'target_temperature_max', input: null, display: null, type: 'float', unit: '°C' },
    { htmlId: 'humid-min', jsonKey: 'target_humidity_min', input: null, display: null, type: 'float', unit: '%' },
    { htmlId: 'humid-max', jsonKey: 'target_humidity_max', input: null, display: null, type: 'float', unit: '%' },
    { htmlId: 'fan-duration', jsonKey: 'fan_run_duration_minutes', input: null, display: null, type: 'float', unit: ' min' },
    { htmlId: 'fan-interval', jsonKey: 'fan_interval_minutes', input: null, display: null, type: 'float', unit: ' min' },
    { htmlId: 'lights-on-hour', jsonKey: 'lights_on_hour_UTC', input: null, display: null, type: 'int', unit: ':00' },
    { htmlId: 'lights-off-hour', jsonKey: 'lights_off_hour_UTC', input: null, display: null, type: 'int', unit: ':00' }
];





function connectMQTT() {//initiate websocket connection 
    client = mqtt.connect(mqttBroker, { clientId: mqttClientId }); //used to manage the connection globally

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

    client.on('message', function (topic, payload) {
        const rawPayloadString = payload.toString().trim(); //converts the payload into JS string and removes any whitespace from start and end
        console.log(`MQTT: Received message on ${topic}. Payload: ${rawPayloadString}"`);
    
        if (topic === mqttTopicSensors) { //try catch prevents crashing on malformed data
            try {
                const data = JSON.parse(rawPayloadString); //takes line and turns it to js string
                console.log('MQTT: Parsed sensor data:', data);
                handleSensorData(data); //data is then passed into the handlesensor data
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
            if (!initialConfigLoaded) { //ensures it only runs once as once it runs its set to true
                try {
                    const data = JSON.parse(rawPayloadString);
                    console.log('MQTT: Parsed config status data:', data);
                    updateConfigForm(data); //populates config form
                    initialConfigLoaded = true;
                } catch (error) {
                    console.error('MQTT: Error parsing JSON message on farm/sensors/status:', error, "payload:", rawPayloadString);
                }
            }
        } else if (topic === mqttTopicAlerts) {
            handleAlert(rawPayloadString);
        }
    });

    client.on('error', function (err) {
        console.error('MQTT: Connection error:', err);
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

///displays 
//guages and high lows
function handleSensorData(data) {
    //prevents crash from program reciving a message before guages are loaded
    // it just refreshes the guage using the data
    if (humid_gauge) {
      humid_gauge.refresh(data.humidity);
    }
    if (temp_guage) {
        temp_guage.refresh(data.temperature);
    }

    //find the relevant IDS 
    const dailyHumidHighElement = document.getElementById('daily-humid-high');
    const dailyHumidLowElement = document.getElementById('daily-humid-low');
    const dailyTempHighElement = document.getElementById('daily-temp-high');
    const dailyTempLowElement = document.getElementById('daily-temp-low');

    //if the check is seccuessful and the key exists in data it writes the value to 1 decimal place ie 82.9
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

//device card updater
function handleDeviceState(data, recalculateOnlyParam) {
    /* when a new message comes from /devices the fucntion gets called without the second para 
    so it defaults to false so a full update is called
    recalculation set to true only the energy functions  */
    const recalculateOnly = recalculateOnlyParam || false; 

    console.log("handleDeviceState called. Data:", data, "Recalculate only:", recalculateOnly); // DEBUG
    if (!data) return; //if theres no data it wont crash

    /* section only runs in full update mode
    safety check to see if they key(ie pump) exists in data before using it
    then changes the led state based on if its 1 or 0  */
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

    // for each device this updates the time on and energy use
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

                //splits the time and calulates the mintues
                const totalHours = hours + (minutes / 60);
                const powerWatts = DEVICE_POWER_WATTS[deviceType]; //checks power raiting for the device
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
    //calls the function for eachdevice
    updateDeviceCurrentDisplay('pump', 'pump_time_on', pumpTimeOnElement, pumpEnergyElement);
    updateDeviceCurrentDisplay('mister', 'mister_time_on', misterTimeOnElement, misterEnergyElement);
    updateDeviceCurrentDisplay('heater', 'heater_time_on', heaterTimeOnElement, heaterEnergyElement);
    updateDeviceCurrentDisplay('lights', 'lights_time_on', lightTimeOnElement, lightsEnergyElement);
    updateDeviceCurrentDisplay('fan', 'fan_time_on', fanTimeOnElement, fanEnergyElement);

    //if its a full update it runs these two extra function 
    if (!recalculateOnly) {
    currentDeviceState = data;
    updateOverrideButtonStates(currentDeviceState); //on off buttons 
    console.log("Mode and override states updated (not a recalculation).");

    setConfigInputDisplayAndState(currentDeviceState.mode_over); //MODES
}


}

function handleAlert(alertMessage) {
    console.warn('Received Alert:', alertMessage); //warning stays after the alert hides
    const alertContainer = document.getElementById('alert-container'); //area on the page where the alert will show
    if (alertContainer) { 
        const alertDiv = document.createElement('div');
        alertDiv.className = 'error'; //css option - NEED TO ADD
        alertDiv.textContent = alertMessage; //this is the message to e shown
        alertContainer.appendChild(alertDiv);

        setTimeout(() => alertDiv.remove(), 5000);//error will go after a period of time
    } else {
        console.error('alert-container not found');
        alert(alertMessage)
    }
}

function update_led_state(state, ledId) {
    const led_element = document.getElementById(ledId); //finds target element and the state either 1/0
    if (led_element) { //if the element has been found 
        if (state === 1) {
            led_element.classList.add('green');//add the green css
            led_element.classList.remove('red');
        } else if (state === 0) {
            led_element.classList.add('red');//adds red css
            led_element.classList.remove('green');
        } else {
            console.warn(`Invalid state: ${state} for LED ${ledId}. Expected 0 or 1.`);
            led_element.classList.add('red');//defualt state red 
        }
    } else {
        console.error(`LED element not found: ${ledId}`);
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


//settings 
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

    updateConfigForm(config);


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

//form managment 
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

//WATTAGE
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

//API CALLS
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

function formatSecondsToHhMm(totalSeconds) {
    if (totalSeconds === undefined || totalSeconds < 0) {
        return "--:--";
    }
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

document.addEventListener('DOMContentLoaded', function () {


   allConfigControls.forEach(control => {
        control.input = document.getElementById(`${control.htmlId}-input`);
        control.display = document.getElementById(`${control.htmlId}-display`);
    });

    // --- Step B: Initialize UI and load data ---
    loadWattagesFromLocalStorage();
    initializeWattageInputs();
    updateTime(); // Call once immediately

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

    const addButtonListener = (elementId, event, callback) => {
            const button = document.getElementById(elementId);
            if (button) {
                button.addEventListener(event, callback);
            } else {
                console.error(`Event listener setup failed: Element with ID '${elementId}' not found.`);
            }
        };

    // Device override buttons
    ['pump', 'heater', 'fan', 'mister', 'lights'].forEach(device => {
        addButtonListener(`${device}-on`, 'click', () => setDeviceState(device, 'on'));
        addButtonListener(`${device}-off`, 'click', () => setDeviceState(device, 'off'));
        addButtonListener(`${device}-auto`, 'click', () => setDeviceState(device, 'no override'));
    });

    // Mode buttons
    addButtonListener('mode-fruiting-button', 'click', () => setDeviceState('mode', 'fruiting'));
    addButtonListener('mode-colonisation-button', 'click', () => setDeviceState('mode', 'colonisation'));

    // Configuration button
    addButtonListener('config-toggle-button', 'click', toggleConfigEditMode);

    connectMQTT();
    fetchAndDisplayHistoricalEnergy();
    setInterval(fetchAndDisplayHistoricalEnergy, 60 * 60 * 1000); 
    setInterval(updateTime, 1000);
    setConfigInputDisplayAndState("fruiting");

});
