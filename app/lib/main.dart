import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_markdown/flutter_markdown.dart';
import 'package:http/http.dart' as http;
import 'package:intl/intl.dart';
import 'package:shared_preferences/shared_preferences.dart';

const apiBase = String.fromEnvironment('GETLEARNY_API_URL', defaultValue: 'https://getlearny.vercel.app/api/v1');
const ink = Color(0xFF10233F);
const blue = Color(0xFF235DDB);
const gold = Color(0xFFFFC857);
const paper = Color(0xFFF5F7FB);

void main() => runApp(const GetLearnyApp());

class GetLearnyApp extends StatelessWidget {
  const GetLearnyApp({super.key});
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: 'GetLearny', debugShowCheckedModeBanner: false,
    theme: ThemeData(useMaterial3: true, scaffoldBackgroundColor: paper,
      colorScheme: ColorScheme.fromSeed(seedColor: blue, primary: blue, secondary: gold),
      appBarTheme: const AppBarTheme(backgroundColor: paper, foregroundColor: ink, elevation: 0),
      inputDecorationTheme: InputDecorationTheme(filled: true, fillColor: Colors.white,
        border: OutlineInputBorder(borderRadius: BorderRadius.circular(14), borderSide: BorderSide.none),
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14)),
      cardTheme: CardThemeData(color: Colors.white, elevation: 0, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)))),
    home: const Shell(),
  );
}

class ApiClient {
  static String? token;
  static Future<Map<String, dynamic>> request(String path, {String method='GET', Map<String,dynamic>? body}) async {
    if (apiBase.isEmpty) throw Exception('offline');
    final uri = Uri.parse('$apiBase$path');
    final response = await (method == 'POST'
      ? http.post(uri, headers: _headers(), body: jsonEncode(body ?? {}))
      : method == 'PATCH'
        ? http.patch(uri, headers: _headers(), body: jsonEncode(body ?? {}))
        : http.get(uri, headers: _headers())).timeout(const Duration(seconds: 12));
    final decoded = response.body.isEmpty ? <String,dynamic>{} : jsonDecode(response.body) as Map<String,dynamic>;
    if (response.statusCode < 200 || response.statusCode >= 300) throw Exception(decoded['error'] ?? 'Request failed');
    return decoded;
  }
  static Map<String,String> _headers() => {'Content-Type':'application/json', if (token != null) 'Authorization':'Bearer $token'};
}

class Shell extends StatefulWidget { const Shell({super.key}); @override State<Shell> createState()=>_ShellState(); }
class _ShellState extends State<Shell> {
  int index=0; String name='Learner'; bool signedIn=false;
  final pages = const [DashboardPage(), SubjectsPage(), PracticePage(), JournalPage(), ProfilePage()];
  @override void initState(){ super.initState(); _restore(); }
  Future<void> _restore() async { final p=await SharedPreferences.getInstance(); ApiClient.token=p.getString('token'); if(mounted)setState((){name=p.getString('name')??'Learner'; signedIn=ApiClient.token!=null;}); }
  @override Widget build(BuildContext context)=>Scaffold(
    appBar: AppBar(title: Row(children:[Container(width:36,height:36,decoration:BoxDecoration(color:ink,borderRadius:BorderRadius.circular(11)),child:const Center(child:Text('G',style:TextStyle(color:gold,fontWeight:FontWeight.w900,fontSize:22)))),const SizedBox(width:10),const Text('GetLearny',style:TextStyle(fontWeight:FontWeight.w800,letterSpacing:-.5)),const Spacer(),IconButton(onPressed:()=>setState(()=>index=4),icon:const Icon(Icons.account_circle_outlined))])),
    body: SafeArea(child:IndexedStack(index:index,children: pages.map((p)=>p is DashboardPage ? DashboardPage(name:name) : p).toList())),
    bottomNavigationBar: NavigationBar(selectedIndex:index,onDestinationSelected:(i)=>setState(()=>index=i),destinations:const [NavigationDestination(icon:Icon(Icons.grid_view_rounded),label:'Home'),NavigationDestination(icon:Icon(Icons.menu_book_rounded),label:'Subjects'),NavigationDestination(icon:Icon(Icons.quiz_outlined),label:'Practice'),NavigationDestination(icon:Icon(Icons.edit_note_rounded),label:'Journal'),NavigationDestination(icon:Icon(Icons.person_outline),label:'Profile')]),
  );
}

class DashboardPage extends StatefulWidget { final String name; const DashboardPage({super.key,this.name='Learner'}); @override State<DashboardPage> createState()=>_DashboardPageState(); }
class _DashboardPageState extends State<DashboardPage> {
  int done=0; bool loading=false; Map<String,dynamic>? remote;
  final subjects=[['Mathematics',Icons.functions,0.62],['English Language',Icons.translate,0.74],['Integrated Science',Icons.science_outlined,0.48],['Social Studies',Icons.public,0.35]];
  @override void initState(){super.initState(); _load();}
  Future<void> _load() async { if(apiBase.isEmpty)return; setState(()=>loading=true); try {final r=await ApiClient.request('/dashboard'); if(mounted)setState(()=>remote=r);} catch (_) {} finally {if(mounted)setState(()=>loading=false);} }
  @override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.fromLTRB(20,8,20,28),children:[
    Text('MONDAY, STUDY DAY',style:TextStyle(fontSize:11,letterSpacing:1.5,fontWeight:FontWeight.w800,color:Colors.blueGrey.shade500)),const SizedBox(height:8),
    Text('Let’s make progress, ${widget.name.split(' ').first}.',style:const TextStyle(fontSize:26,fontWeight:FontWeight.w900,color:ink,height:1.12)),const SizedBox(height:18),
    Container(padding:const EdgeInsets.all(22),decoration:BoxDecoration(gradient:const LinearGradient(colors:[ink,Color(0xFF1C4778)],begin:Alignment.topLeft,end:Alignment.bottomRight),borderRadius:BorderRadius.circular(24)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Row(children:[const Expanded(child:Text('YOUR WASSCE JOURNEY',style:TextStyle(color:gold,fontSize:11,letterSpacing:1.3,fontWeight:FontWeight.w800))),Container(padding:const EdgeInsets.symmetric(horizontal:10,vertical:6),decoration:BoxDecoration(color:Colors.white.withValues(alpha:.12),borderRadius:BorderRadius.circular(20)),child:const Text('SHS 3',style:TextStyle(color:Colors.white,fontSize:11,fontWeight:FontWeight.w700)))]),const SizedBox(height:14),const Text('Small steps.\nStrong results.',style:TextStyle(color:Colors.white,fontSize:28,fontWeight:FontWeight.w900,height:1.1)),const SizedBox(height:10),Text('Build the foundations you need, one topic at a time.',style:TextStyle(color:Colors.white.withValues(alpha:.78))),const SizedBox(height:18),Row(children:[Expanded(child:FilledButton(onPressed:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>const LessonPage(subject:'Mathematics',topic:'Algebra foundations'))),style:FilledButton.styleFrom(backgroundColor:gold,foregroundColor:ink),child:const Text('Continue learning'))),const SizedBox(width:10),IconButton.filledTonal(onPressed:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>const PracticePage())),icon:const Icon(Icons.arrow_forward_rounded))])])),
    const SizedBox(height:22),Row(children:[const Expanded(child:SectionTitle('Your overview')),if(loading)const SizedBox(width:16,height:16,child:CircularProgressIndicator(strokeWidth:2))]),const SizedBox(height:12),Row(children:[Expanded(child:StatCard(icon:Icons.local_fire_department_outlined,label:'Study streak',value:'—',tint:Color(0xFFFFE6BC))),const SizedBox(width:10),Expanded(child:StatCard(icon:Icons.task_alt,label:'Topics covered',value:'${remote?['progress']?['completedTopics'] ?? done}',tint:Color(0xFFD9F5E8))),const SizedBox(width:10),Expanded(child:StatCard(icon:Icons.timer_outlined,label:'This week',value:remote==null?'—':'${remote?['progress']?['minutesStudied'] ?? 0} min',tint:Color(0xFFDCE7FF)))]),
    const SizedBox(height:24),const SectionTitle('Pick up where you left off'),const SizedBox(height:12),...subjects.map((s)=>SubjectTile(name:s[0] as String,icon:s[1] as IconData,progress:(s[2] as double),onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>LessonPage(subject:s[0] as String,topic:'Foundations and core concepts'))))),
    const SizedBox(height:18),Container(padding:const EdgeInsets.all(18),decoration:BoxDecoration(color:const Color(0xFFFFF4D9),borderRadius:BorderRadius.circular(20)),child:const Row(crossAxisAlignment:CrossAxisAlignment.start,children:[Icon(Icons.lightbulb_outline,color:Color(0xFF9B6800)),SizedBox(width:12),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('Today’s reminder',style:TextStyle(fontWeight:FontWeight.w800,color:ink)),SizedBox(height:5),Text('Learn the basics first. If a topic feels difficult, revisit its prerequisites before moving on.',style:TextStyle(height:1.4,color:ink))]))]))
  ]);
}

class SubjectsPage extends StatelessWidget { const SubjectsPage({super.key}); final items=const [['Mathematics','Algebra • Number • Geometry'],['English Language','Comprehension • Summary • Essay'],['Integrated Science','Biology • Chemistry • Physics'],['Social Studies','Governance • Environment • Economy'],['Elective Mathematics','Functions • Calculus • Vectors'],['ICT','Networks • Data • Computing']];
 @override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.all(20),children:[const SectionTitle('Your subjects'),const SizedBox(height:6),const Text('Strengthen prerequisites, then practise WASSCE-style questions.'),const SizedBox(height:16),...items.map((e)=>Card(child:ListTile(contentPadding:const EdgeInsets.all(14),leading:Container(width:48,height:48,decoration:BoxDecoration(color:const Color(0xFFE4ECFF),borderRadius:BorderRadius.circular(14)),child:const Icon(Icons.menu_book_rounded,color:blue)),title:Text(e[0],style:const TextStyle(fontWeight:FontWeight.w800)),subtitle:Text(e[1]),trailing:const Icon(Icons.chevron_right),onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>TopicListPage(subject:e[0]))))))]); }

class TopicListPage extends StatefulWidget {
 final String subject;
 const TopicListPage({super.key,required this.subject});
 @override State<TopicListPage> createState()=>_TopicListPageState();
}
class _TopicListPageState extends State<TopicListPage>{
 bool loading=false; String error=''; List<Map<String,dynamic>> topics=[];
 String get code=>({'Mathematics':'MATH','English Language':'ENG','Integrated Science':'SCI','Social Studies':'SOC','Elective Mathematics':'EMATH','ICT':'ICT'}[widget.subject]??'MATH');
 @override void initState(){super.initState();_loadTopics();}
 Future<void> _loadTopics()async{
  setState(()=>{loading=true,error=''});
  try{
   final result=await ApiClient.request('/topics?subject=$code&limit=100');
   final rows=(result['topics'] as List? ?? []);
   if(!mounted)return;
   setState(()=>topics=rows.map((e)=>Map<String,dynamic>.from(e as Map)).toList());
  }catch(e){if(mounted)setState(()=>error='Could not load the live topic catalogue. Check your connection and retry.');}
  finally{if(mounted)setState(()=>loading=false);}
 }
 @override Widget build(BuildContext context)=>Scaffold(
  appBar:AppBar(title:Text(widget.subject)),
  body:ListView(padding:const EdgeInsets.all(20),children:[
   Text('Study path',style:Theme.of(context).textTheme.headlineSmall?.copyWith(fontWeight:FontWeight.w900)),
   const SizedBox(height:8),
   const Text('Live topics from the GetLearny catalogue. Choose a topic to open its lesson.'),
   const SizedBox(height:18),
   if(loading)const Center(child:Padding(padding:EdgeInsets.all(28),child:CircularProgressIndicator())),
   if(error.isNotEmpty)...[Text(error,style:const TextStyle(color:Colors.deepOrange)),TextButton.icon(onPressed:_loadTopics,icon:const Icon(Icons.refresh),label:const Text('Retry'))],
   if(!loading&&error.isEmpty&&topics.isEmpty)const Text('No topics are published for this subject yet.'),
   ...topics.map((topic)=>Card(child:ListTile(
    leading:CircleAvatar(backgroundColor:gold,foregroundColor:ink,child:const Icon(Icons.menu_book_outlined)),
    title:Text(topic['title']?.toString()??'Topic',style:const TextStyle(fontWeight:FontWeight.w700)),
    subtitle:Text(topic['description']?.toString()??'Select to study this topic'),
    trailing:const Icon(Icons.arrow_forward_ios,size:15),
    onTap:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>LessonPage(subject:widget.subject,topic:topic['title']?.toString()??'Topic'))),
   )))
  ])
 );
}

class LessonPage extends StatefulWidget {final String subject,topic;const LessonPage({super.key,required this.subject,required this.topic});@override State<LessonPage> createState()=>_LessonPageState();}
class _LessonPageState extends State<LessonPage>{bool busy=false;String? lesson;String error='';@override void initState(){super.initState();_generate();}Future<void> _generate()async{if(apiBase.isEmpty){setState(()=>error='The learning service URL is not configured.');return;}setState(()=>busy=true);try{final r=await ApiClient.request('/lessons/generate',method:'POST',body:{'subject':widget.subject,'topic':widget.topic,'level':'SHS 3','exam':'WASSCE'});setState(()=>lesson=r['lesson'] as String? ?? 'Lesson unavailable');}catch(e){setState(()=>error='Could not reach the online learning service. Check your connection and sign in, then retry.');lesson=null;}finally{if(mounted)setState(()=>busy=false);}}
@override Widget build(BuildContext context)=>Scaffold(appBar:AppBar(title:Text(widget.subject)),body:ListView(padding:const EdgeInsets.all(20),children:[Text(widget.topic,style:const TextStyle(fontSize:26,fontWeight:FontWeight.w900,color:ink)),const SizedBox(height:8),const Text('LEARN • UNDERSTAND • APPLY',style:TextStyle(color:blue,fontSize:11,letterSpacing:1.3,fontWeight:FontWeight.w800)),if(error.isNotEmpty)...[Padding(padding:const EdgeInsets.only(top:12),child:Text(error,style:const TextStyle(color:Colors.deepOrange))),TextButton.icon(onPressed:_generate,icon:const Icon(Icons.refresh),label:const Text('Retry connection'))],const SizedBox(height:16),if(busy)const Center(child:CircularProgressIndicator())else if(lesson!=null)Card(child:Padding(padding:const EdgeInsets.all(18),child:MarkdownBody(data:lesson!))),const SizedBox(height:18),FilledButton.icon(onPressed:()=>Navigator.of(context).push(MaterialPageRoute(builder:(_)=>const PracticePage())),icon:const Icon(Icons.quiz_outlined),label:const Text('Try practice questions'))]));}

class PracticePage extends StatefulWidget {const PracticePage({super.key});@override State<PracticePage> createState()=>_PracticePageState();}
class _PracticePageState extends State<PracticePage>{int q=0;int? selected;int score=0;bool finished=false;final questions=const [QuizQ('Which operation undoes addition?', ['Multiplication','Subtraction','Division','Squaring'],1,'Subtract the same amount from both sides to keep an equation balanced.'),QuizQ('What is 3 × (4 + 2)?',['18','14','20','10'],0,'Evaluate the brackets first: 4 + 2 = 6, then 3 × 6 = 18.'),QuizQ('Which is a renewable energy source?',['Coal','Diesel','Solar','Natural gas'],2,'Solar energy is replenished naturally by sunlight.')];
@override Widget build(BuildContext context){final item=questions[q.clamp(0,questions.length-1)];return Scaffold(appBar:AppBar(title:const Text('Quick practice')),body:ListView(padding:const EdgeInsets.all(20),children:[Container(padding:const EdgeInsets.all(20),decoration:BoxDecoration(color:ink,borderRadius:BorderRadius.circular(20)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(finished?'PRACTICE COMPLETE':'QUESTION ${q+1} OF ${questions.length}',style:const TextStyle(color:gold,fontWeight:FontWeight.w800,letterSpacing:1.3,fontSize:11)),const SizedBox(height:12),Text(finished?'You scored $score/${questions.length}':'Choose the best answer.',style:const TextStyle(color:Colors.white,fontWeight:FontWeight.w800,fontSize:23))])),const SizedBox(height:20),if(!finished)...[Text(item.question,style:const TextStyle(fontSize:22,fontWeight:FontWeight.w900,color:ink)),const SizedBox(height:16),...item.options.asMap().entries.map((e)=>Padding(padding:const EdgeInsets.only(bottom:10),child:Card(child:RadioListTile<int>(value:e.key,groupValue:selected,onChanged:(v)=>setState(()=>selected=v),title:Text(e.value),activeColor:blue)))),if(selected!=null)Container(padding:const EdgeInsets.all(16),decoration:BoxDecoration(color:const Color(0xFFE2F6E9),borderRadius:BorderRadius.circular(16)),child:Text(item.explanation,style:const TextStyle(height:1.4))),const SizedBox(height:10),FilledButton(onPressed:selected==null?null:(){setState((){if(selected==item.answer)score++;if(q<questions.length-1){q++;selected=null;}else{finished=true;}});},child:Text(q==questions.length-1?'Finish practice':'Check & continue'))]else... [Text(score>=2?'Nice work — keep building consistency.':'Good effort. Review the explanations and try again.'),const SizedBox(height:18),FilledButton(onPressed:()=>setState((){q=0;score=0;selected=null;finished=false;}),child:const Text('Try again'))]]));}}
class QuizQ{final String question;final List<String> options;final int answer;final String explanation;const QuizQ(this.question,this.options,this.answer,this.explanation);}

class JournalPage extends StatefulWidget{const JournalPage({super.key});@override State<JournalPage> createState()=>_JournalPageState();}
class _JournalPageState extends State<JournalPage>{final learned=TextEditingController();final difficult=TextEditingController();final next=TextEditingController();final entries=<Map<String,String>>[];@override void dispose(){learned.dispose();difficult.dispose();next.dispose();super.dispose();}@override void initState(){super.initState();_loadEntries();}
Future<void> _loadEntries()async{
 if(ApiClient.token==null)return;
 try{
  final result=await ApiClient.request('/journal');
  final rows=(result['entries'] as List? ?? []);
  if(!mounted)return;
  setState(()=>entries
   ..clear()
   ..addAll(rows.map((row){final e=Map<String,dynamic>.from(row as Map);return <String,String>{
    'date':e['created_at']==null?'Recent':DateFormat('d MMM yyyy').format(DateTime.parse(e['created_at'].toString()).toLocal()),
    'learned':e['learned']?.toString()??'','difficult':e['difficult']?.toString()??'','next':e['next_step']?.toString()??''
   };})));
 }catch(_){}
}
Future<void> save()async{
 if(learned.text.trim().isEmpty)return;
 if(ApiClient.token==null){ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Sign in from Profile before syncing your journal.')));return;}
 final entry={'date':DateFormat('d MMM yyyy').format(DateTime.now()),'learned':learned.text.trim(),'difficult':difficult.text.trim(),'next':next.text.trim()};
 try{
  await ApiClient.request('/journal',method:'POST',body:{'learned':entry['learned'],'difficult':entry['difficult'],'next_step':entry['next']});
 }catch(e){ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text('Could not sync reflection: ${e.toString().replaceFirst('Exception: ','')}')));return;}
 setState(()=>entries.insert(0,entry));
 learned.clear();difficult.clear();next.clear();FocusScope.of(context).unfocus();
 ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Study reflection synced to your account.')));
}
@override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.all(20),children:[const SectionTitle('Learning journal'),const SizedBox(height:6),const Text('A quick reflection helps you spot what to revise next.'),const SizedBox(height:18),JournalField(label:'What did you learn today?',hint:'I finally understand…',controller:learned),const SizedBox(height:12),JournalField(label:'What was difficult?',hint:'I need more practice with…',controller:difficult),const SizedBox(height:12),JournalField(label:'What will you do next?',hint:'Tomorrow I will…',controller:next),const SizedBox(height:14),FilledButton.icon(onPressed:save,icon:const Icon(Icons.save_outlined),label:const Text('Save reflection')),const SizedBox(height:24),const SectionTitle('Recent reflections'),const SizedBox(height:10),if(entries.isEmpty)const Text('Your reflections will appear here.'),...entries.map((e)=>Card(child:Padding(padding:const EdgeInsets.all(16),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(e['date']!,style:const TextStyle(color:blue,fontWeight:FontWeight.w800)),const SizedBox(height:6),Text(e['learned']!),if(e['difficult']!.isNotEmpty)Text('Challenge: ${e['difficult']}'),if(e['next']!.isNotEmpty)Text('Next: ${e['next']}')]))))]);}
class JournalField extends StatelessWidget{final String label,hint;final TextEditingController controller;const JournalField({super.key,required this.label,required this.hint,required this.controller});@override Widget build(BuildContext context)=>Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(label,style:const TextStyle(fontWeight:FontWeight.w800)),const SizedBox(height:7),TextField(controller:controller,minLines:2,maxLines:4,decoration:InputDecoration(hintText:hint))]);}

class ProfilePage extends StatefulWidget{const ProfilePage({super.key});@override State<ProfilePage> createState()=>_ProfilePageState();}
class _ProfilePageState extends State<ProfilePage>{final email=TextEditingController();final password=TextEditingController();final name=TextEditingController();bool register=false,busy=false;@override void dispose(){email.dispose();password.dispose();name.dispose();super.dispose();}Future<void> submit()async{if(apiBase.isEmpty){ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Connect an API URL to create an account.')));return;}setState(()=>busy=true);try{final r=await ApiClient.request(register?'/auth/register':'/auth/login',method:'POST',body:{'email':email.text.trim(),'password':password.text,if(register)'name':name.text.trim()});ApiClient.token=r['token'];final p=await SharedPreferences.getInstance();await p.setString('token',r['token']);await p.setString('name',r['user']['name']??'Learner');if(mounted)setState(()=>register=false);if(mounted)ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content:Text('Signed in successfully.')));}catch(e){if(mounted)ScaffoldMessenger.of(context).showSnackBar(SnackBar(content:Text(e.toString().replaceFirst('Exception: ',''))));}finally{if(mounted)setState(()=>busy=false);}}
@override Widget build(BuildContext context)=>ListView(padding:const EdgeInsets.all(20),children:[const SectionTitle('Your profile'),const SizedBox(height:8),Container(padding:const EdgeInsets.all(20),decoration:BoxDecoration(color:ink,borderRadius:BorderRadius.circular(22)),child:const Row(children:[CircleAvatar(radius:28,backgroundColor:gold,child:Icon(Icons.school_rounded,color:ink,size:30)),SizedBox(width:14),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text('GetLearny learner',style:TextStyle(color:Colors.white,fontSize:18,fontWeight:FontWeight.w800)),SizedBox(height:4),Text('Your WASSCE preparation space',style:TextStyle(color:Colors.white70))]))])),const SizedBox(height:20),Text(register?'Create your account':'Sign in to sync your progress',style:const TextStyle(fontSize:19,fontWeight:FontWeight.w900)),const SizedBox(height:12),if(register)...[TextField(controller:name,decoration:const InputDecoration(labelText:'Full name')),const SizedBox(height:10)],TextField(controller:email,keyboardType:TextInputType.emailAddress,decoration:const InputDecoration(labelText:'Email')),const SizedBox(height:10),TextField(controller:password,obscureText:true,decoration:const InputDecoration(labelText:'Password (8+ characters)')),const SizedBox(height:12),FilledButton(onPressed:busy?null:submit,child:Text(busy?'Please wait…':register?'Create account':'Sign in')),TextButton(onPressed:()=>setState(()=>register=!register),child:Text(register?'Already have an account? Sign in':'New here? Create an account')),const SizedBox(height:12),const Text('Online learning service',style:TextStyle(fontWeight:FontWeight.w800)),const SizedBox(height:6),Text('API endpoint: $apiBase',style:const TextStyle(color:Colors.blueGrey))]);}

class SectionTitle extends StatelessWidget{final String text;const SectionTitle(this.text,{super.key});@override Widget build(BuildContext context)=>Text(text,style:const TextStyle(fontSize:20,fontWeight:FontWeight.w900,color:ink,letterSpacing:-.4));}
class StatCard extends StatelessWidget{final IconData icon;final String label,value;final Color tint;const StatCard({super.key,required this.icon,required this.label,required this.value,required this.tint});@override Widget build(BuildContext context)=>Container(padding:const EdgeInsets.all(12),decoration:BoxDecoration(color:Colors.white,borderRadius:BorderRadius.circular(18)),child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Container(padding:const EdgeInsets.all(7),decoration:BoxDecoration(color:tint,borderRadius:BorderRadius.circular(10)),child:Icon(icon,size:18,color:ink)),const SizedBox(height:12),Text(value,style:const TextStyle(fontSize:17,fontWeight:FontWeight.w900,color:ink)),const SizedBox(height:3),Text(label,style:const TextStyle(fontSize:10,color:Colors.blueGrey))]));}
class SubjectTile extends StatelessWidget{final String name;final IconData icon;final double progress;final VoidCallback onTap;const SubjectTile({super.key,required this.name,required this.icon,required this.progress,required this.onTap});@override Widget build(BuildContext context)=>Padding(padding:const EdgeInsets.only(bottom:10),child:Card(child:InkWell(borderRadius:BorderRadius.circular(20),onTap:onTap,child:Padding(padding:const EdgeInsets.all(14),child:Row(children:[Container(width:44,height:44,decoration:BoxDecoration(color:const Color(0xFFE4ECFF),borderRadius:BorderRadius.circular(13)),child:Icon(icon,color:blue)),const SizedBox(width:12),Expanded(child:Column(crossAxisAlignment:CrossAxisAlignment.start,children:[Text(name,style:const TextStyle(fontWeight:FontWeight.w800,color:ink)),const SizedBox(height:8),ClipRRect(borderRadius:BorderRadius.circular(10),child:LinearProgressIndicator(value:progress,minHeight:6,backgroundColor:const Color(0xFFE8ECF3))) ])),const SizedBox(width:10),Text('${(progress*100).round()}%',style:const TextStyle(fontWeight:FontWeight.w800,color:blue))])))));}
