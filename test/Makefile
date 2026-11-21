SHELL := /bin/bash -euo pipefail

NO_COLOR=\x1b[0m
TARGET_COLOR=\x1b[96m

clean:
	@echo -e "$(TARGET_COLOR)Running clean$(NO_COLOR)"
	@cd .. && make clean

install:
	@echo -e "$(TARGET_COLOR)Running install$(NO_COLOR)"
	@cd .. && make install

build: lambda
	@echo Building application...
	@bun run build

diff: build
	@echo Running diff...
	@AWS_REGION=us-east-1 bun run cdk diff --color

deploy: build
	@echo Deploying application...
	@AWS_REGION=us-east-1 bun run cdk deploy --color --require-approval never

DESTROY: build
	@echo Destroying application...
	@AWS_REGION=us-east-1 bun run cdk destroy --color --force

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
