install:
	@cd .. && npm i

build: install lambda
	@npm run build

deploy: build
	@cdk deploy --require-approval never

DESTROY: build
	@cdk destroy --force

lambda:
	@../lambda/build
