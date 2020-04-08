build:
	@npm run build

deploy: build lambda
	@cdk deploy --require-approval never

DESTROY: build
	@cdk destroy --force

lambda:
	@../lambda/build
