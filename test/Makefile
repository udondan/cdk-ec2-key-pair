build:
	@npm run build

deploy: build lambda
	@cdk deploy --require-approval never EC2KeyPair

DESTROY: build
	@cdk destroy --force EC2KeyPair

lambda:
	@../lambda/build
