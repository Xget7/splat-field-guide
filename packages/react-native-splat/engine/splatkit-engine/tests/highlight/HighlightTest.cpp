#include "splatkit/highlight/Highlight.h"

#include <vector>

#include <gtest/gtest.h>

namespace splatkit {
namespace {

constexpr float kTolerance = 1e-6f;

void finishFade(Highlight& highlight) {
  while (highlight.update(0.05f)) {
  }
}

void expectAsCaptured(const LabelStyle& style) {
  EXPECT_EQ(style.tintAmount, 0.0f);
  EXPECT_EQ(style.brightness, 1.0f);
  EXPECT_EQ(style.opacity, 1.0f);
}

TEST(Highlight, StartsWithEverySplatAsCaptured) {
  Highlight highlight(65536);
  EXPECT_FALSE(highlight.fading());
  EXPECT_FALSE(highlight.update(1));
  for (std::size_t i = 0; i < highlight.styles().states().size(); ++i)
    expectAsCaptured(highlight.styles()[i]);
}

TEST(Highlight, EmphasisesItsPartsAndDimsEverythingElse) {
  Highlight highlight(65536);
  const std::vector<std::uint16_t> labels = {256, 65535};
  highlight.set(labels.data(), labels.size());
  finishFade(highlight);
  const LabelStyles& styles = highlight.styles();
  for (const std::uint16_t label : labels) {
    EXPECT_EQ(styles[label].tintAmount, Highlight::kTintAmount);
    EXPECT_EQ(styles[label].tint[2], Highlight::kTint[2]);
    EXPECT_EQ(styles[label].brightness, Highlight::kEmphasisBrightness);
  }
  EXPECT_EQ(styles[0].brightness, Highlight::kDimBrightness);
  EXPECT_EQ(styles[4].brightness, Highlight::kDimBrightness);
  EXPECT_EQ(styles[255].tintAmount, 0.0f);
  EXPECT_EQ(styles[4].opacity, 1.0f);
}

TEST(Highlight, FadesOverAQuarterSecondThenRests) {
  Highlight highlight(65536);
  const std::uint16_t label = 5;
  highlight.set(&label, 1);
  EXPECT_TRUE(highlight.fading());
  ASSERT_TRUE(highlight.update(Highlight::kFadeSeconds / 2));
  EXPECT_NEAR(highlight.styles()[label].tintAmount, Highlight::kTintAmount / 2, kTolerance);
  EXPECT_NEAR(highlight.styles()[1].brightness, (1 + Highlight::kDimBrightness) / 2, kTolerance);
  ASSERT_TRUE(highlight.update(Highlight::kFadeSeconds / 2));
  EXPECT_FALSE(highlight.fading());
  EXPECT_FALSE(highlight.update(1));
  EXPECT_EQ(highlight.styles()[label].tintAmount, Highlight::kTintAmount);
}

TEST(Highlight, AnEmptySetFadesBackToTheCapture) {
  Highlight highlight(65536);
  const std::uint16_t label = 5;
  highlight.set(&label, 1);
  finishFade(highlight);
  highlight.set(nullptr, 0);
  ASSERT_TRUE(highlight.update(Highlight::kFadeSeconds / 2));
  EXPECT_EQ(highlight.styles()[label].tint[0], Highlight::kTint[0]);
  finishFade(highlight);
  for (std::size_t i = 0; i < highlight.styles().states().size(); ++i)
    expectAsCaptured(highlight.styles()[i]);
}

TEST(Highlight, RetargetStartsFromTheCurrentAppearance) {
  Highlight highlight(10);
  const uint16_t first = 5;
  const uint16_t second = 9;
  highlight.set(&first, 1);
  highlight.update(Highlight::kFadeSeconds / 2);
  highlight.set(&second, 1);
  EXPECT_FLOAT_EQ(highlight.styles()[first].brightness, (1 + Highlight::kEmphasisBrightness) / 2);
  finishFade(highlight);
  EXPECT_FLOAT_EQ(highlight.styles()[first].brightness, Highlight::kDimBrightness);
  EXPECT_FLOAT_EQ(highlight.styles()[second].brightness, Highlight::kEmphasisBrightness);
}

TEST(Highlight, InvalidLabelsWarnOnce) {
  Highlight highlight(45);
  const uint16_t invalid = 45;
  testing::internal::CaptureStderr();
  highlight.set(&invalid, 1);
  highlight.set(&invalid, 1);
  const auto warning = testing::internal::GetCapturedStderr();
  const auto first = warning.find("Highlight label outside world label count");
  ASSERT_NE(first, std::string::npos);
  EXPECT_EQ(warning.find("Highlight label outside world label count", first + 1),
            std::string::npos);
}

TEST(Highlight, RepeatedRetargetingKeepsPaletteBounded) {
  Highlight highlight(45);
  for (uint16_t label = 1; label < 45; ++label) {
    highlight.set(&label, 1);
    highlight.update(0.01f);
    EXPECT_TRUE(highlight.styles().validFor(45));
  }
  finishFade(highlight);
  EXPECT_FLOAT_EQ(highlight.styles()[44].brightness, Highlight::kEmphasisBrightness);
}

TEST(Highlight, TheSetItHeadsForAgainChangesNothing) {
  Highlight highlight(65536);
  const std::vector<std::uint16_t> labels = {256, 65535};
  const std::vector<std::uint16_t> sameParts = {65535, 256, 65535};
  highlight.set(labels.data(), labels.size());
  ASSERT_TRUE(highlight.update(Highlight::kFadeSeconds / 2));
  highlight.set(sameParts.data(), sameParts.size());  // a re-render sends the parts again
  ASSERT_TRUE(highlight.update(Highlight::kFadeSeconds / 2));
  EXPECT_FALSE(highlight.fading());
  highlight.set(sameParts.data(), sameParts.size());
  EXPECT_FALSE(highlight.fading());
  EXPECT_EQ(highlight.styles()[256].tintAmount, Highlight::kTintAmount);
}

TEST(Highlight, ClearingWhatIsNotHighlightedChangesNothing) {
  Highlight highlight(65536);
  highlight.set(nullptr, 0);
  EXPECT_FALSE(highlight.fading());
}

}  // namespace
}  // namespace splatkit
