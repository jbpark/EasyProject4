import 'package:flutter/material.dart';

const Map<String, Color> kStatusColor = {
  'pending': Color(0xFF64748B),
  'idle': Color(0xFF64748B),
  'running': Color(0xFF38BDF8),
  'done': Color(0xFF4ADE80),
  'error': Color(0xFFF87171),
  'dead': Color(0xFF64748B),
};

const Map<String, String> kStatusLabel = {
  'pending': '대기',
  'idle': '대기',
  'running': '실행 중',
  'done': '완료',
  'error': '실패',
  'dead': '종료',
};

Color statusColor(String s) => kStatusColor[s] ?? const Color(0xFF64748B);
String statusLabel(String s) => kStatusLabel[s] ?? s;

class StatusChip extends StatelessWidget {
  final String status;
  const StatusChip(this.status, {super.key});

  @override
  Widget build(BuildContext context) {
    final c = statusColor(status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
      decoration: BoxDecoration(
        color: c.withValues(alpha: 0.16),
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: c.withValues(alpha: 0.5)),
      ),
      child: Text(statusLabel(status),
          style: TextStyle(color: c, fontSize: 11.5, fontWeight: FontWeight.w600)),
    );
  }
}

class Dot extends StatelessWidget {
  final String status;
  const Dot(this.status, {super.key});
  @override
  Widget build(BuildContext context) => Container(
        width: 9,
        height: 9,
        decoration:
            BoxDecoration(color: statusColor(status), shape: BoxShape.circle),
      );
}
