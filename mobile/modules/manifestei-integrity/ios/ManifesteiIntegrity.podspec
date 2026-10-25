Pod::Spec.new do |s|
  s.name           = 'ManifesteiIntegrity'
  s.version        = '1.0.0'
  s.summary        = 'App Attest e localização segura para o Manifestei'
  s.description    = 'Ponte nativa para DCAppAttestService e CoreLocation com detecção de localização simulada.'
  s.author         = 'Manifestei'
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'DeviceCheck', 'CoreLocation'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
