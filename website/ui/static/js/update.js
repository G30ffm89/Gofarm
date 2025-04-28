let humid_gauge;
let temp_guage;
let thchart;

// MQTT Configuration
const mqttBroker = 'ws://localhost:9001';
const mqttClientId = 'web-client-' + Math.random().toString(16).substr(2, 8);
const mqttTopicSensors = 'farm/sensors/sensors';
const mqttTopicDevices = 'farm/sensors/devices';

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
        const timeLabel = data.timestamp.substring(11, 16); // Extract HH:MM from timestamp
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

// Function to handle device state data
function handleDeviceState(data) {
    update_led_state(data.pump, 'pump_led');   // Use lowercase 'pump'
    update_led_state(data.heater, 'heater_led'); // Use lowercase 'heater'
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

document.addEventListener('DOMContentLoaded', function() {
    // Initialize charts and gauges
    const ctx = document.getElementById('temp_humid_chart');
    function createChart(temperature = [], humidity = [], timeLabel = []) { // Initialize with empty arrays
        thchart = new Chart(ctx, {
            type: 'line',
            data: {
                labels: timeLabel,
                datasets: [
                    {
                        label: 'Temperature',
                        data: temperature,
                        yAxisID: 'y',
                    },
                    {
                        label: 'Humidity',
                        data: humidity,
                        yAxisID: 'y1',
                    }
                ]
            },
            options: {
                scales: {
                    y:{
                        type: 'linear',
                        display: true,
                        position: 'left',
                    },
                    y1:{
                        type: 'linear',
                        display: true,
                        position: 'right',
                    }
                },
                maintainAspectRatio: false
            }
        });
    }

    createChart(); // Call createChart without initial data
    humid_gauge = new JustGage({ id: "humid-guage", title: "Humidity", label: "%", value: 0, min: 0, max: 100 });
    temp_guage = new JustGage({ id: "temp-guage", title: "Temperature", label: "°C", value: 0, min: 0, max: 30 });

    // Connect to MQTT
    connectMQTT();

});
