useful 
https://github.com/pryce-jones-systems/bird-watcher/tree/main

https://cedalo.com/blog/mosquitto-docker-configuration-ultimate-guide/


docker network create farm-network

docker run -it -d --name mos1 --network farm-network -p 1883:1883 -p 9001:9001 -v /etc/mosquitto/conf.d/listeners.conf:/mosquitto/config/mosquitto.conf eclipse-mosquitto:2

docker build --no-cache --progress=plain -t farm-webcam-image -f Dockerfile.webcam .

docker run --privileged -p 8081:8081 -d --name farm-webcam-container --network farm-network farm-webcam-image

docker build --no-cache --progress=plain -t farm-controller-image -f Dockerfile .

docker run --privileged -d --name farm-controller-container --network farm-network --link mos1:mqtt farm-controller-image

docker volume create farmdatabase

docker build -f Dockerfile.website -t farm-site-container 

docker run -p 4000:4000 --name farm-website --network farm-network farm-site-container

  # website:
  #   build:
  #     context: .
  #     dockerfile: Dockerfile.website
  #   container_name: website
  #   networks:
  #     - farm-network
  #   ports:
  #     - "4000:4000"
  #   volumes:
  #     - /home/mike/Documents/Gofarm/website/cmd/web/instance/:/app/instance/
  #     - /home/mike/Documents/Gofarm/website/ui/:/app/ui/
  #   depends_on:
  #     - mosquitto