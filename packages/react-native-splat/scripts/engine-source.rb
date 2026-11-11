require "digest"
require "fileutils"
require "json"
require "open3"
require "tmpdir"

# Export committed blobs, never the upstream working tree or downstream patches.
module EngineSource
  RECEIPT = "engine-source.json"
  PACKAGES = %w[splat-core splatkit-engine splatkit-ios splatkit-android].freeze
  ROOT_FILES = %w[LICENSE .clang-format .clang-tidy].freeze

  def self.git(repository, *args)
    output, error, status = Open3.capture3("git", "-C", repository, *args)
    raise "SplatKit source: #{error.strip}" unless status.success?
    output
  end

  def self.import!(package, repository, revision)
    raise "Expected a full SplatKit commit SHA" unless revision&.match?(/\A[0-9a-f]{40}\z/)
    resolved = git(repository, "rev-parse", "--verify", "#{revision}^{commit}").strip
    raise "Expected a commit, not a tag object" unless resolved == revision
    entries = git(repository, "ls-tree", "-rz", revision).split("\0").filter_map do |entry|
      metadata, source = entry.split("\t", 2)
      relative = if ROOT_FILES.include?(source)
                   source
                 elsif source.start_with?("packages/") && PACKAGES.include?(source.split("/")[1])
                   source.delete_prefix("packages/")
                 end
      next unless relative
      mode, type, blob = metadata.split(" ")
      raise "Unsupported upstream entry: #{source}" unless type == "blob" && %w[100644 100755].include?(mode)
      raise "Unsafe upstream path: #{source}" if relative.split("/").any? { |part| part == ".." || part == "." }
      [relative, blob, mode]
    end
    PACKAGES.each do |name|
      raise "Missing upstream package: #{name}" unless entries.any? { |entry| entry[0].start_with?("#{name}/") }
    end
    ROOT_FILES.each do |name|
      raise "Missing upstream source record: #{name}" unless entries.any? { |entry| entry[0] == name }
    end
    Dir.mktmpdir("engine-import-", package) do |stage|
      candidate = File.join(stage, "engine")
      FileUtils.mkdir_p(candidate)
      files = {}
      entries.each do |relative, blob, mode|
        bytes = git(repository, "cat-file", "blob", blob)
        file = File.join(candidate, relative)
        FileUtils.mkdir_p(File.dirname(file))
        File.binwrite(file, bytes)
        File.chmod(mode == "100755" ? 0o755 : 0o644, file)
        files[relative] = { "sha256" => Digest::SHA256.hexdigest(bytes), "executable" => mode == "100755" }
      end
      receipt = { "revision" => revision, "files" => files }
      File.write(File.join(stage, RECEIPT), JSON.pretty_generate(receipt) + "\n")
      verify!(stage)
      engine = File.join(package, "engine")
      record = File.join(package, RECEIPT)
      backup = File.join(stage, "previous")
      old_record = File.binread(record) if File.exist?(record)
      File.rename(engine, backup) if File.exist?(engine)
      begin
        File.rename(candidate, engine)
        File.rename(File.join(stage, RECEIPT), record)
      rescue StandardError
        FileUtils.rm_rf(engine)
        File.rename(backup, engine) if File.exist?(backup)
        old_record ? File.binwrite(record, old_record) : FileUtils.rm_f(record)
        raise
      end
    end
    revision
  end

  def self.verify!(package)
    receipt = JSON.parse(File.read(File.join(package, RECEIPT)))
    raise "Invalid SplatKit revision" unless receipt.fetch("revision").match?(/\A[0-9a-f]{40}\z/)
    engine = File.join(package, "engine")
    actual = {}
    Dir.glob(File.join(engine, "**", "*"), File::FNM_DOTMATCH).each do |file|
      raise "Symlink in imported SplatKit source: #{file}" if File.symlink?(file)
      next if File.directory?(file)
      actual[file.delete_prefix("#{engine}/")] = {
        "sha256" => Digest::SHA256.file(file).hexdigest,
        "executable" => (File.stat(file).mode & 0o111) != 0
      }
    end
    raise "Imported SplatKit sources differ from the receipt" unless actual == receipt.fetch("files")
    receipt.fetch("revision")
  end
end
