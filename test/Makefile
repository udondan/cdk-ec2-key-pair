build:
	@npm run build

list: build
	cdk ls

diff: build
	@cdk diff

synth: build
	@cdk synth

deploy: build lambda
	@cdk deploy

destroy: build
	@cdk destroy

lambda:
	@../lambda/build
