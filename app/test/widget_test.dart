import 'package:flutter_test/flutter_test.dart';
import 'package:getlearny/main.dart';

void main() {
  testWidgets('dashboard renders core GetLearny navigation', (tester) async {
    await tester.pumpWidget(const GetLearnyApp());
    await tester.pump(const Duration(milliseconds: 500));
    expect(find.text('GetLearny'), findsOneWidget);
    expect(find.text('Subjects'), findsOneWidget);
    expect(find.text('Practice'), findsOneWidget);
  });
}
