require "digest"

# Preparation and CocoaPods share a fingerprint independent of git state.
module EngineArtifact
  FINGERPRINT_FILE = "source-fingerprint.sha256"
  FRAMEWORK = "ios/Frameworks/SplatKitCore.xcframework"
  SOURCE_EXTENSIONS = %w[.cpp .c .h .hpp .mm .m .metal .metalh .cmake .modulemap].freeze
  SLICES = %w[ios-arm64 ios-arm64-simulator].freeze

  def self.fingerprint(package)
    files = Dir.glob(File.join(package, "engine", "**", "*" )).select do |file|
      File.file?(file) && !file.start_with?(File.join(package, "engine", "splatkit-android") + File::SEPARATOR) && !file.delete_prefix("#{package}/").split(File::SEPARATOR).include?("build") &&
        (SOURCE_EXTENSIONS.include?(File.extname(file)) || File.basename(file) == "CMakeLists.txt")
    end
    files += %w[build-ios-engine.sh engine-artifact.rb package-ios-engine.py].map { |name| File.join(package, "scripts", name) }
    digest = Digest::SHA256.new
    files.sort.each do |file|
      digest.update(file.delete_prefix("#{package}/"))
      digest.update("\0")
      digest.update(Digest::SHA256.file(file).hexdigest)
      digest.update("\0")
    end
    digest.hexdigest
  end

  def self.verify!(package)
    framework = File.join(package, FRAMEWORK)
    stamp = File.join(framework, FINGERPRINT_FILE)
    complete = File.file?(File.join(framework, "Info.plist")) && SLICES.all? do |slice|
      File.file?(File.join(framework, slice, "libSplatKitCore.a"))
    end
    unless complete && File.file?(stamp) && File.read(stamp).strip == fingerprint(package)
      raise "ReactNativeSplat: engine framework is missing or stale; run scripts/prepare.sh from the repository root, then pod install again"
    end
  end
end

if $PROGRAM_NAME == __FILE__
  package = File.expand_path("..", __dir__)
  case ARGV.shift
  when nil
    puts EngineArtifact.fingerprint(package)
  when "--verify"
    EngineArtifact.verify!(package)
  when "--record"
    output, fingerprint = ARGV
    raise "Expected a framework path and source fingerprint" unless output && fingerprint&.match?(/\A[0-9a-f]{64}\z/)
    File.write(File.join(output, EngineArtifact::FINGERPRINT_FILE), "#{fingerprint}\n")
  else
    abort "Usage: engine-artifact.rb [--verify | --record <framework> <fingerprint>]"
  end
end
