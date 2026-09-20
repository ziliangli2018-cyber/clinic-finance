-- LOCAL DEVELOPMENT ONLY. Hosted migrations default to production/mock-disabled.
update private.runtime_config
set environment = 'development', allow_mock_data = true
where singleton = true;
