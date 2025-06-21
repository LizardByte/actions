class HelloWorld < Formula
  desc "Simple program that outputs 'Hello, World!'"
  homepage "https://app.lizardbyte.dev"
  url "https://github.com/LizardByte/homebrew-release-action.git"
  version "0.0.1"

  def install
    # create hello world sh file with echo command
    (buildpath/"hello-world").write <<~EOS
      #!/bin/sh
      echo "Hello, World!"
    EOS

    # install the hello-world file to the bin directory
    bin.install "hello-world"

    puts "buildpath: #{buildpath}"
  end

  test do
    system "#{bin}/hello-world"

    puts "testpath: #{testpath}"

    # test the env
    if ENV["HOMEBREW_BUILDPATH"]
      dummy_filename = "dummy.txt"
      cd File.join(ENV["HOMEBREW_BUILDPATH"]) do
        # create a dummy file
        File.write(dummy_filename, "Hello, World!")
        assert_path_exists dummy_filename
      end
      assert_path_exists File.join(ENV["HOMEBREW_BUILDPATH"], dummy_filename)
    end
  end
end
