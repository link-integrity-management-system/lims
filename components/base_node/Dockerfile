FROM node:20.17.0 AS base

RUN useradd -rm -d /home/ubuntu -s /bin/bash -g root -G sudo -u 1001 ubuntu
RUN addgroup --gid 1001 ubuntu
RUN apt-get update
RUN apt-get install nano less

USER ubuntu
RUN mkdir /home/ubuntu/app

USER root