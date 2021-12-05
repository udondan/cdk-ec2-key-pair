clean:
	@rm -rf ../node_modules ../package-lock.json
	@rm -rf node_modules package-lock.json

install: clean
	@echo Installing dependencies...
	@cd .. && npm i
	@npm i

build: install lambda
	@echo Building application...
	@npm run build

deploy: build
	@echo Deploying application...
	@npm run cdk -- deploy --require-approval never

DESTROY: build
	@echo Destroying application...
	@npm run cdk -- destroy --force

lambda:
	@echo Building Lambda...
	@../lambda/build
