useful 
https://github.com/pryce-jones-systems/bird-watcher/tree/main

https://cedalo.com/blog/mosquitto-docker-configuration-ultimate-guide/

docker network create farm-network

docker run -it -d --name mos1 --network farm-network -p 1883:1883 -p 9001:9001 -v /etc/mosquitto/conf.d/listeners.conf:/mosquitto/config/mosquitto.conf eclipse-mosquitto:2

docker build --no-cache --progress=plain -t farm-webcam-image -f Dockerfile.webcam .

docker run --privileged -p 8081:8081 -d --name farm-webcam-container --network farm-network farm-webcam-image

docker build --no-cache --progress=plain -t farm-controller-image -f Dockerfile .

docker run --privileged -d --name farm-controller-container --network farm-network --link mos1:mqtt farm-controller-image
