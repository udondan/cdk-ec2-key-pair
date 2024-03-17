SHELL := /bin/bash -euo pipefail

NO_COLOR=\x1b[0m
TARGET_COLOR=\x1b[96m

clean:
	@echo -e "$(TARGET_COLOR)Running clean$(NO_COLOR)"
	@rm -rf ../node_modules ../package-lock.json
	@rm -rf node_modules package-lock.json

install:
	@echo -e "$(TARGET_COLOR)Running install$(NO_COLOR)"
	@cd .. && make install
	@npm clean-install --prefer-offline --cache ../.npm
	@npm list

build: install lambda
	@echo Building application...
	@npm run build

diff: build
	@echo Running diff...
	@AWS_REGION=us-east-1 npm run cdk -- diff --color

deploy: build
	@echo Deploying application...
	@AWS_REGION=us-east-1 npm run cdk -- deploy --color --require-approval never

DESTROY: build
	@echo Destroying application...
	@AWS_REGION=us-east-1 npm run cdk -- destroy --color --force

lambda:
	@echo Building Lambda...
	@../lambda/build

get-secret-values:
	@AWS_REGION=us-east-1 aws secretsmanager get-secret-value \
		--secret-id ec2-ssh-key/CFN-signing-key/private \
		--query SecretString \
		--output text
	@AWS_REGION=us-east-1 aws secretsmanager get-secret-value \
		--secret-id ec2-ssh-key/CFN-signing-key/public \
		--query SecretString \
		--output text
