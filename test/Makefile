install:
	@echo Installing dependencies...
	@cd .. && npm i

build: install lambda
	@echo Building application...
	@npm run build

deploy: build
	@echo Deploying application...
	@cdk deploy --require-approval never

DESTROY: build
	@echo Destroying application...
	@cdk destroy --force

lambda:
	@echo Building Lambda...
	@../lambda/build
