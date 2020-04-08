build:
	@npm run build

deploy: build lambda
	@cdk deploy --require-approval never

DESTROY: build
	@cdk destroy --require-approval never

lambda:
	@../lambda/build
